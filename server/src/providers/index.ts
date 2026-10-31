import type { z } from "zod";
import type {
  ChatArgs,
  ChatPolicy,
  ChatResult,
  DemoOptions,
  ProviderEnv,
  ProviderName,
} from "./types.ts";
import { stripFences } from "./jsonschema.ts";
import { HttpError, isFallbackable, shortError, fallbackReasonFor } from "./http.ts";
import { chatMeta } from "./meta.ts";
import { chatBaseten } from "./baseten.ts";

export type { AttemptInfo, ChatArgs, ChatImage, ChatPolicy, ChatResult, DemoOptions, Fixture, ProviderEnv, ProviderName, UsageInfo } from "./types.ts";
export { chatMeta } from "./meta.ts";
export { chatBaseten } from "./baseten.ts";
export { zodToJsonSchema, stripFences, formatIssues } from "./jsonschema.ts";

// TODO(SAM 3.1, optional — not built yet):
// - Only available on POST /v1/responses, model "sam-3.1"
// - input: [{type:"message", role:"user", content:[{type:"input_text", text:"<noun>"}, {type:"input_image", image_url:"data:..."}]}]
// - Output: <|box…|><|mask…|> text lines, parsed with @meta-sam/parser
//   (ask the owner before installing it).

function log(
  provider: ProviderName,
  latencyMs: number,
  retries: number,
  extra = "",
): void {
  console.log(
    `[providers] answered by=${provider} latencyMs=${latencyMs} retries=${retries}${extra ? ` ${extra}` : ""}`,
  );
}

/**
 * Replay a recorded fixture with zero network. The content goes through the
 * same strip → parse → Zod-validate path as a live response, so stale
 * fixtures fail loudly instead of silently passing.
 */
export function replayFixture<S extends z.ZodTypeAny>(
  args: ChatArgs<S>,
  opts: DemoOptions,
): ChatResult<z.infer<S>> {
  const fx = opts.fixtures[opts.key];
  if (!fx) throw new Error(`DEMO_MODE=1: no fixture for key "${opts.key}"`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(fx.content));
  } catch {
    throw new Error(`DEMO_MODE=1: fixture "${opts.key}" is not valid JSON`);
  }
  const validated = args.schema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(`DEMO_MODE=1: fixture "${opts.key}" failed schema validation`);
  }
  log(fx.provider, fx.latencyMs, 0, `key=${opts.key} demo=replay`);
  return {
    data: validated.data as z.infer<S>,
    raw: fx.content,
    provider: fx.provider,
    latencyMs: fx.latencyMs,
    retries: 0,
  };
}

/**
 * Meta first, Baseten fallback. Falls back on timeout (15 s text / 45 s
 * vision), 429/5xx, network errors, and schema validation still failing
 * after 1 retry. Config errors (missing keys, over image limits) and other
 * 4xx fail loud with no fallback — except 401/403 when policy.authFallback
 * is set (server route only; the eval runner never sets it, so bad keys
 * stay loud there). With policy.fallback "none", a would-be fallback
 * instead throws policy.noFallbackMessage (map ingest). Logs provider +
 * latency + reason, never the key.
 */
export async function chat<S extends z.ZodTypeAny>(
  args: ChatArgs<S>,
  env: ProviderEnv,
  opts?: DemoOptions,
  policy?: ChatPolicy,
): Promise<ChatResult<z.infer<S>>> {
  if (env.DEMO_MODE === "1") {
    if (!opts) throw new Error("DEMO_MODE=1 needs {key, fixtures}");
    return replayFixture(args, opts);
  }
  try {
    const r = await chatMeta(args, env);
    log("meta", r.latencyMs, r.retries);
    return r;
  } catch (e) {
    const authFailure =
      policy?.authFallback === true &&
      e instanceof HttpError &&
      (e.status === 401 || e.status === 403);
    if (!isFallbackable(e) && !authFailure) throw e;
    if ((policy?.fallback ?? "baseten") === "none") {
      throw new Error(
        policy?.noFallbackMessage ?? "request failed and fallback is disabled",
        { cause: e },
      );
    }
    if (authFailure) {
      console.log("[providers] meta auth failed — CHECK KEYS, falling back to baseten");
    } else {
      console.log(`[providers] meta failed (${shortError(e)}); falling back to baseten`);
    }
    const r = await chatBaseten(args, env);
    r.fallbackReason = fallbackReasonFor(e);
    log("baseten", r.latencyMs, r.retries, `reason=${r.fallbackReason}`);
    return r;
  }
}
