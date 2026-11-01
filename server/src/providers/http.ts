import type { ChatImage, ProviderName } from "./types.ts";

/** Config bug (missing key, over image limits) — never falls back, fails loud. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
/** HTTP error with status. 429/5xx fall back; other 4xx fail loud. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
/** Abort/timeout or fetch-level failure — falls back. */
export class NetworkError extends Error {
  readonly code: "timeout" | "network";
  constructor(code: "timeout" | "network", message: string) {
    super(message);
    this.name = "NetworkError";
    this.code = code;
  }
}
/** Response failed extraction/validation after the 1 retry — falls back. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export const TEXT_TIMEOUT_MS = 15_000;
export const VISION_TIMEOUT_MS = 45_000;

type ChatMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

/** OpenAI-style chat messages; images as base64 data URLs. Uniform parts. */
export function toMessages(
  system: string,
  user: string,
  images: ChatImage[],
): ChatMessage[] {
  const userParts: ChatMessage["content"] = [
    { type: "text", text: user },
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:${img.mime};base64,${img.b64}` },
    })),
  ];
  return [
    { role: "system", content: system },
    { role: "user", content: userParts },
  ];
}

export function appendRetryMessage(
  messages: ChatMessage[],
  detail: string,
): ChatMessage[] {
  return [
    ...messages,
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Your previous response was invalid: ${detail}. Reply with corrected JSON only.`,
        },
      ],
    },
  ];
}

export async function postJson(
  url: string,
  key: string,
  body: unknown,
  timeoutMs: number,
  /** outer abort (hedge loser). Timeout still applies on top of it. */
  signal?: AbortSignal,
): Promise<{ status: number; json: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = (): void => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      throw new NetworkError("network", `unparseable response body (status ${res.status})`);
    }
    return { status: res.status, json };
  } catch (e) {
    if (e instanceof NetworkError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new NetworkError("timeout", `request timed out after ${timeoutMs}ms`);
    }
    throw new NetworkError("network", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** Read choices[0].message.content as a string; anything else is an error. */
export function readContent(json: unknown): string {
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new ValidationError("empty or missing choices[0].message.content");
  }
  return content;
}

export function isFallbackable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status >= 500;
  return e instanceof NetworkError || e instanceof ValidationError;
}

/** Short fallback reason. Never bodies or headers. */
export function fallbackReasonFor(e: unknown, primary: ProviderName = "meta"): string {
  if (e instanceof HttpError) return `${primary} ${e.status}`;
  if (e instanceof NetworkError) {
    return e.code === "timeout" ? `${primary} timeout` : `${primary} network-error`;
  }
  if (e instanceof ValidationError) return `${primary} invalid-response`;
  return `${primary} error`;
}

interface RawUsage {
  choices?: Array<{ finish_reason?: unknown }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    total_tokens?: unknown;
  };
}

/** Pull finish_reason/usage out of a chat-completions response, if present. */
export function readUsage(json: unknown): import("./types.ts").UsageInfo | undefined {
  const j = (json ?? {}) as RawUsage;
  const out: import("./types.ts").UsageInfo = {};
  const fr = j.choices?.[0]?.finish_reason;
  if (typeof fr === "string") out.finishReason = fr;
  const u = j.usage;
  if (u && typeof u === "object") {
    if (typeof u.prompt_tokens === "number") out.promptTokens = u.prompt_tokens;
    if (typeof u.completion_tokens === "number") out.completionTokens = u.completion_tokens;
    if (typeof u.total_tokens === "number") out.totalTokens = u.total_tokens;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function shortError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : String(e);
}
