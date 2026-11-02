import { chat, type ProviderEnv } from "./providers/index.ts";
import {
  INGEST_PROMPT,
  IngestSchema,
  type IngestData,
} from "./ingest-contract.ts";
import {
  capMergedIngest,
  mergeIngestRuns,
  type MergedIngest,
} from "./ingest-merge.ts";

/**
 * POST /ingest: map photo → merged layout draft (3 parallel Meta runs,
 * majority merge). Map only for now — no directory photo, no Baseten
 * fallback (T2 showed Baseten can't read maps).
 */

export const MAX_MAP_BYTES = 3_145_728; // 3 MB decoded
/** raw body cap, checked before JSON parse */
export const MAX_BODY_CHARS = 4_500_000;
export const INGEST_TIMEOUT_MS = 45_000; // per call
export const INGEST_TOTAL_MS = 60_000; // whole request
export const INGEST_RUNS = 3;

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
}

export function validateIngestRequest(body: unknown): ValidIngest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new IngestError(400, "body must be a JSON object");
  }
  const image = (body as Record<string, unknown>).image as
    | Record<string, unknown>
    | undefined;
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new IngestError(400, "image must be {mime, b64}");
  }
  if (typeof image.mime !== "string" || !ALLOWED_MIME.has(image.mime)) {
    throw new IngestError(400, "mime must be image/jpeg or image/png");
  }
  if (typeof image.b64 !== "string" || !image.b64.trim()) {
    throw new IngestError(400, "b64 must be a non-empty base64 string");
  }
  const b64 = image.b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) {
    throw new IngestError(400, "b64 is not valid base64");
  }
  const bytes = Math.ceil((b64.length * 3) / 4);
  if (bytes > MAX_MAP_BYTES) {
    throw new IngestError(413, `image exceeds 3 MB (${bytes} bytes)`);
  }
  return { mime: image.mime, b64 };
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
  const { mime, b64 } = validateIngestRequest(body);
  const t0 = Date.now();
  const calls = Array.from({ length: INGEST_RUNS }, () =>
    chatImpl(
      {
        system: INGEST_PROMPT.system,
        user: INGEST_PROMPT.user,
        images: [{ mime, b64 }],
        schema: IngestSchema,
        name: "ingest_map",
        timeoutMs: INGEST_TIMEOUT_MS,
      },
      env,
      undefined,
      { fallback: false },
    ).then((r) => r.data),
  );
  const ok: IngestData[] = [];
  let done = 0;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, totalMs);
    const finish = (): void => {
      if (++done === INGEST_RUNS) {
        clearTimeout(timer);
        resolve();
      }
    };
    for (const p of calls) {
      p.then(
        (d) => {
          ok.push(d);
          finish();
        },
        () => finish(),
      );
    }
  });
  if (ok.length === 0) {
    throw new IngestError(502, "Couldn't read this map — try a sharper photo");
  }
  const merged = capMergedIngest(mergeIngestRuns(ok));
  const items = merged.aisles.reduce((s, a) => s + a.items.length, 0);
  const log =
    `[ingest] runsOk=${merged.runsOk} aisles=${merged.aisles.length} ` +
    `items=${items} depts=${merged.departments.length} entr=${merged.entrances.length} ` +
    `lowConfidence=${merged.lowConfidence} provider=meta latencyMs=${Date.now() - t0}`;
  return { status: 200, json: { ...merged, provider: "meta" }, log };
}
