import { chat, type ProviderEnv } from "./providers/index.ts";
import {
  READLIST_PROMPT,
  ReadListSchema,
  type ReadListData,
} from "./readlist-contract.ts";

/**
 * POST /read-list: list/recipe photo → items + notes.
 * Uses the same prompt + schema as the T4 eval (readlist-v1).
 * Items are post-processed to /resolve caps so the app can pass them
 * straight through to typed matching.
 */

export const MAX_IMAGE_BYTES = 1_572_864; // 1.5 MB decoded
export const MAX_ITEMS = 30;
export const MAX_ITEM_CHARS = 60;
export const READLIST_TIMEOUT_MS = 30_000;
export const READLIST_HEDGE_MS = 8_000;

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export class ReadListError extends Error {
  readonly status: 400 | 413;
  constructor(status: 400 | 413, message: string) {
    super(message);
    this.name = "ReadListError";
    this.status = status;
  }
}

export interface ValidReadList {
  mime: string;
  b64: string;
}

export function validateReadListRequest(body: unknown): ValidReadList {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ReadListError(400, "body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (typeof b.storeId !== "string" || !b.storeId.trim()) {
    throw new ReadListError(400, "storeId must be a non-empty string");
  }
  const image = b.image as Record<string, unknown> | undefined;
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new ReadListError(400, "image must be {mime, b64}");
  }
  if (typeof image.mime !== "string" || !ALLOWED_MIME.has(image.mime)) {
    throw new ReadListError(400, "mime must be image/jpeg, image/png, or image/webp");
  }
  if (typeof image.b64 !== "string" || !image.b64.trim()) {
    throw new ReadListError(400, "b64 must be a non-empty base64 string");
  }
  const b64 = image.b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/=]*$/.test(b64)) {
    throw new ReadListError(400, "b64 is not valid base64");
  }
  const bytes = Math.ceil((b64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new ReadListError(413, `image exceeds 1.5 MB (${bytes} bytes)`);
  }
  return { mime: image.mime, b64 };
}

export interface CleanItem {
  text: string;
  quantity: string;
}

function cleanText(s: string): string {
  return s
    .trim()
    .replace(/^[-|•]+\s*/, "")
    .replace(/[.,]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Trim, strip bullets/trailing punctuation, drop empties, dedupe
 * case-insensitively, cap 30 items × 60 chars. Notes are trimmed and
 * de-emptied only.
 */
export function cleanReadList(data: ReadListData): { items: CleanItem[]; notes: string[] } {
  const items: CleanItem[] = [];
  const seen = new Set<string>();
  for (const it of data.items) {
    const text = cleanText(it.text).slice(0, MAX_ITEM_CHARS);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ text, quantity: (it.quantity ?? "").trim() });
    if (items.length >= MAX_ITEMS) break;
  }
  const notes = data.notes.map((n) => n.trim()).filter(Boolean);
  return { items, notes };
}

export interface ReadListOk {
  status: 200;
  json: {
    items: CleanItem[];
    notes: string[];
    provider: string;
    fallbackReason?: string;
  };
  /** counts only — never image data */
  log: string;
}

export async function handleReadList(
  body: unknown,
  env: ProviderEnv,
  chatImpl: typeof chat = chat,
): Promise<ReadListOk> {
  const { mime, b64 } = validateReadListRequest(body);
  const res = await chatImpl(
    {
      system: READLIST_PROMPT.system,
      user: READLIST_PROMPT.user,
      images: [{ mime, b64 }],
      schema: ReadListSchema,
      name: "read_list",
      timeoutMs: READLIST_TIMEOUT_MS,
    },
    env,
    undefined,
    { primary: "meta", authFallback: true, hedgeMs: READLIST_HEDGE_MS },
  );
  const { items, notes } = cleanReadList(res.data);
  const log =
    `[read-list] items=${items.length} notes=${notes.length} ` +
    `provider=${res.provider} latencyMs=${res.latencyMs} retries=${res.retries}` +
    (res.fallbackReason ? ` reason=${res.fallbackReason}` : "");
  return {
    status: 200,
    json: {
      items,
      notes,
      provider: res.provider,
      ...(res.fallbackReason ? { fallbackReason: res.fallbackReason } : {}),
    },
    log,
  };
}
