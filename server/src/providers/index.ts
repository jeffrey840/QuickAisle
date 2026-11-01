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
import { hedged } from "./hedge.ts";
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

type ChatFn = typeof chatMeta;

/**
 * First/second provider for a policy (exported for the offline test).
 * Default primary is Meta; /resolve sets primary "baseten" (§10).
 */
export function providerOrder(policy?: ChatPolicy): {
  first: ChatFn;
  second: ChatFn;
  firstName: ProviderName;
  secondName: ProviderName;
} {
  if ((policy?.primary ?? "meta") === "baseten") {
    return { first: chatBaseten, second: chatMeta, firstName: "baseten", secondName: "meta" };
  }
  return { first: chatMeta, second: chatBaseten, firstName: "meta", secondName: "baseten" };
}

/**
 * Primary first, the other provider as fallback. Falls back on timeout
 * (15 s text / 45 s vision unless args.timeoutMs overrides), 429/5xx,
 * network errors, and schema validation still failing after 1 retry.
 * Config errors (missing keys, over image limits) and other 4xx fail
 * loud with no fallback — except 401/403 when policy.authFallback is set
 * (server route only; the eval runner never sets it, so bad keys stay
 * loud there). With policy.fallback false, a would-be fallback instead
 * throws policy.noFallbackMessage (map ingest). With policy.hedgeMs set
 * (and fallback enabled), the second provider starts early if the
 * primary is slow and the first valid answer wins. Logs provider +
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
  if (policy?.hedgeMs !== undefined && (policy?.fallback ?? true)) {
    return hedgedChat(args, env, policy, policy.hedgeMs);
  }
  const { first, second, firstName, secondName } = providerOrder(policy);
  try {
    const r = await first(args, env);
    log(firstName, r.latencyMs, r.retries);
    return r;
  } catch (e) {
    const authFailure =
      policy?.authFallback === true &&
      e instanceof HttpError &&
      (e.status === 401 || e.status === 403);
    if (!isFallbackable(e) && !authFailure) throw e;
    if (!(policy?.fallback ?? true)) {
      throw new Error(
        policy?.noFallbackMessage ?? "request failed and fallback is disabled",
        { cause: e },
      );
    }
    if (authFailure) {
      console.log(`[providers] ${firstName} auth failed — CHECK KEYS, falling back to ${secondName}`);
    } else {
      console.log(`[providers] ${firstName} failed (${shortError(e)}); falling back to ${secondName}`);
    }
    const r = await second(args, env);
    r.fallbackReason = fallbackReasonFor(e, firstName);
    log(secondName, r.latencyMs, r.retries, `reason=${r.fallbackReason}`);
    return r;
  }
}

/**
 * Hedged variant of chat(): the second provider starts if the primary
 * hasn't answered within hedgeMs. Same fallback triggers as the
 * sequential path; a pure slow-primary loss reports reason
 * "<primary> slow (hedged)".
 */
async function hedgedChat<S extends z.ZodTypeAny>(
  args: ChatArgs<S>,
  env: ProviderEnv,
  policy: ChatPolicy,
  hedgeMs: number,
): Promise<ChatResult<z.infer<S>>> {
  const { first, second, firstName, secondName } = providerOrder(policy);
  const isAuthFailure = (e: unknown): boolean =>
    policy.authFallback === true &&
    e instanceof HttpError &&
    (e.status === 401 || e.status === 403);
  let primaryError: unknown = null;
  const out = await hedged(
    (signal) =>
      first(args, env, { signal }).catch((e: unknown) => {
        primaryError = e;
        throw e;
      }),
    (signal) => second(args, env, { signal }),
    hedgeMs,
    (e) => isFallbackable(e) || isAuthFailure(e),
  );
  const r = out.value;
  if (out.winner === "backup") {
    r.fallbackReason =
      primaryError !== null
        ? fallbackReasonFor(primaryError, firstName)
        : `${firstName} slow (hedged)`;
    if (primaryError !== null && isAuthFailure(primaryError)) {
      console.log(`[providers] ${firstName} auth failed — CHECK KEYS, falling back to ${secondName}`);
    } else {
      console.log(`[providers] hedged: ${secondName} won (${r.fallbackReason})`);
    }
    log(secondName, r.latencyMs, r.retries, `reason=${r.fallbackReason}`);
  } else {
    log(firstName, r.latencyMs, r.retries, out.backupStarted ? "hedge=backup-cancelled" : "");
  }
  return r;
}
