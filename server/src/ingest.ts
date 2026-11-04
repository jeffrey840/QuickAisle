import { chat, type ProviderEnv } from "./providers/index.ts";
import {
  INGEST_PROMPT,
  IngestSchema,
  type IngestData,
} from "./ingest-contract.ts";
import {
  capMergedIngest,
  combineIngestViews,
  mergeIngestRuns,
  type MergedIngest,
} from "./ingest-merge.ts";

/**
 * POST /ingest: map photo → merged layout draft (3 parallel Meta runs per
 * view, majority merge). Optional `rotated` second view: vertical aisles
 * take items from the rotated merge (C4). Map only for now — no directory
 * photo, no Baseten fallback (T2 showed Baseten can't read maps).
 */

export const MAX_MAP_BYTES = 3_145_728; // 3 MB decoded
/**
 * Raw body cap, checked before JSON parse. Two 3 MB images fit:
 * 2 × ceil(3145728 B → base64) = 2 × 4194304 = 8388608 chars, plus
 * ~400 KB headroom for the JSON envelope and whitespace.
 */
export const MAX_BODY_CHARS = 8_800_000;
export const INGEST_TIMEOUT_MS = 50_000; // per call (rotated reads took ~33 s)
export const INGEST_TOTAL_MS = 75_000; // whole request
export const INGEST_RUNS = 3; // per view

const ALLOWED_MIME = new Set(["image/jpeg", "image/png"]);

export class IngestError extends Error {
  readonly status: 400 | 413 | 502;
  constructor(status: 400 | 413 | 502, message: string) {
    super(message);
    this.name = "IngestError";
    this.status = status;
  }
}

export interface ValidIngest {
  mime: string;
  b64: string;
  /** optional second view (map rotated 90° clockwise), same rules as image */
  rotated?: ValidIngestImage;
}

export interface ValidIngestImage {
  mime: string;
  b64: string;
}

function validateImage(v: unknown, field: "image" | "rotated"): ValidIngestImage {
  const prefix = field === "image" ? "" : "rotated ";
  const image = v as Record<string, unknown> | undefined;
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new IngestError(400, `${field} must be {mime, b64}`);
  }
  if (typeof image.mime !== "string" || !ALLOWED_MIME.has(image.mime)) {
    throw new IngestError(400, `${prefix}mime must be image/jpeg or image/png`);
  }
  if (typeof image.b64 !== "string" || !image.b64.trim()) {
    throw new IngestError(400, `${prefix}b64 must be a non-empty base64 string`);
  }
  const b64 = image.b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) {
    throw new IngestError(400, `${prefix}b64 is not valid base64`);
  }
  const bytes = Math.ceil((b64.length * 3) / 4);
  if (bytes > MAX_MAP_BYTES) {
    throw new IngestError(413, `${prefix}image exceeds 3 MB (${bytes} bytes)`);
  }
  return { mime: image.mime, b64 };
}

export function validateIngestRequest(body: unknown): ValidIngest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new IngestError(400, "body must be a JSON object");
  }
  const rec = body as Record<string, unknown>;
  const { mime, b64 } = validateImage(rec.image, "image");
  const out: ValidIngest = { mime, b64 };
  if (rec.rotated !== undefined) {
    out.rotated = validateImage(rec.rotated, "rotated");
  }
  return out;
}

export interface IngestOk {
  status: 200;
  json: MergedIngest & { provider: string };
  /** counts only — never image data */
  log: string;
}

export async function handleIngestText(
  text: string,
  env: ProviderEnv,
  chatImpl: typeof chat = chat,
  totalMs: number = INGEST_TOTAL_MS,
): Promise<IngestOk> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new IngestError(400, "body must be JSON");
  }
  const { mime, b64, rotated } = validateIngestRequest(body);
  const t0 = Date.now();
  const mkCalls = (img: { mime: string; b64: string }): Array<Promise<IngestData>> =>
    Array.from({ length: INGEST_RUNS }, () =>
      chatImpl(
        {
          system: INGEST_PROMPT.system,
          user: INGEST_PROMPT.user,
          images: [img],
          schema: IngestSchema,
          name: "ingest_map",
          timeoutMs: INGEST_TIMEOUT_MS,
        },
        env,
        undefined,
        { fallback: false },
      ).then((r) => r.data),
    );
  // 3 original + 3 rotated reads, all in parallel under one deadline.
  const origCalls = mkCalls({ mime, b64 });
  const rotCalls = rotated ? mkCalls(rotated) : [];
  const total = origCalls.length + rotCalls.length;
  const origOk: IngestData[] = [];
  const rotOk: IngestData[] = [];
  let done = 0;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, totalMs);
    const finish = (): void => {
      if (++done === total) {
        clearTimeout(timer);
        resolve();
      }
    };
    const attach = (p: Promise<IngestData>, bucket: IngestData[]): void => {
      p.then(
        (d) => {
          bucket.push(d);
          finish();
        },
        () => finish(),
      );
    };
    for (const p of origCalls) attach(p, origOk);
    for (const p of rotCalls) attach(p, rotOk);
  });
  if (origOk.length === 0) {
    throw new IngestError(502, "Couldn't read this map — try a sharper photo");
  }
  const origMerged = mergeIngestRuns(origOk);
  const twoView = rotated !== undefined;
  const combined = twoView
    ? combineIngestViews(origMerged, rotOk.length > 0 ? mergeIngestRuns(rotOk) : null)
    : {
        ...origMerged,
        aisles: origMerged.aisles.map((a) => ({ ...a, itemsView: "original" as const })),
      };
  const merged = capMergedIngest(combined);
  const items = merged.aisles.reduce((s, a) => s + a.items.length, 0);
  const log =
    `[ingest] runsOk=${merged.runsOk} aisles=${merged.aisles.length} ` +
    `items=${items} depts=${merged.departments.length} entr=${merged.entrances.length} ` +
    `lowConfidence=${merged.lowConfidence} provider=meta latencyMs=${Date.now() - t0}` +
    (twoView ? ` rotRunsOk=${rotOk.length}` : "");
  return { status: 200, json: { ...merged, provider: "meta" }, log };
}
