import type { z } from "zod";

export type ProviderName = "meta" | "baseten";

export interface ChatImage {
  mime: string;
  b64: string;
}

export interface ChatArgs<S extends z.ZodTypeAny> {
  system: string;
  user: string;
  images?: ChatImage[];
  schema: S;
  /**
   * response_format name. Meta's strict JSON mode requires one;
   * defaults to "response".
   */
  name?: string;
}

export interface UsageInfo {
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Per-attempt diagnostics. Internal + gitignored eval JSON only —
 * never forward this in an app API response.
 */
export interface AttemptInfo {
  usage?: UsageInfo;
  /** validation/extraction message for this attempt only, max ~200 chars */
  error?: string;
}

export interface ChatResult<T> {
  /** Zod-validated payload */
  data: T;
  /** raw model content (kept for fixture recording) */
  raw: string;
  provider: ProviderName;
  latencyMs: number;
  /** validation retries used (0 or 1) */
  retries: number;
  /** response finish/usage, when the provider reports it */
  usage?: UsageInfo;
  /** set when this result came via fallback, e.g. "meta 401" */
  fallbackReason?: string;
  /** per-attempt diagnostics, in order; internal + gitignored JSON only */
  attempts?: AttemptInfo[];
}

export interface ProviderEnv {
  MODEL_API_KEY?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
  DEMO_MODE?: string;
  /**
   * Dev/eval-only Meta base-URL override (origin only, e.g.
   * http://127.0.0.1:9). Honored ONLY when ALLOW_URL_OVERRIDE=1.
   * Never set either as a wrangler var/secret.
   */
  META_BASE_URL?: string;
  ALLOW_URL_OVERRIDE?: string;
}

export interface Fixture {
  key: string;
  provider: ProviderName;
  /** raw model content — parsed + validated on replay, same as live */
  content: string;
  latencyMs: number;
  recordedAt: string;
}

export interface DemoOptions {
  key: string;
  fixtures: Record<string, Fixture>;
}

/**
 * Per-task fallback policy for chat().
 * - List/directory reading (T1-type, /read-list, /resolve) → "baseten".
 * - Map ingest (T2-type, /ingest) → "none" with noFallbackMessage set to
 *   "couldn't read the map, try again".
 * The eval runner calls providers directly and never sets a policy.
 */
export interface ChatPolicy {
  /** also fall back on Meta 401/403 (server route only). Default false. */
  authFallback?: boolean;
  /** default "baseten" */
  fallback?: "baseten" | "none";
  /** message thrown when fallback is "none" and Meta fails */
  noFallbackMessage?: string;
}
