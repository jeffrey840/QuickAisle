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
  /**
   * Per-call timeout override (ms) for both providers. Defaults to
   * 15 s text / 45 s vision. /resolve sets 30 s (§10).
   */
  timeoutMs?: number;
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
 * Per-task provider policy for chat().
 * - /resolve (T3 winner) → primary "baseten", Meta is the fallback.
 * - Vision tasks (directory, /read-list, /ingest) → primary "meta".
 * - Map ingest (T2-type, /ingest) → fallback false with
 *   noFallbackMessage "couldn't read the map, try again".
 * The eval runner calls providers directly and never sets a policy.
 */
export interface ChatPolicy {
  /** which provider goes first. Default "meta". */
  primary?: ProviderName;
  /** fall back to the other provider on failure. Default true. */
  fallback?: boolean;
  /** also fall back on the primary's 401/403 (server route only). Default false. */
  authFallback?: boolean;
  /** message thrown when fallback is false and the primary fails */
  noFallbackMessage?: string;
  /**
   * Start Baseten if Meta hasn't answered within this many ms; first
   * valid answer wins, the loser is aborted. Server route only — the
   * eval runner calls providers directly and never sets it.
   */
  hedgeMs?: number;
}
