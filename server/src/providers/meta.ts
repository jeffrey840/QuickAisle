import type { z } from "zod";
import type { AttemptInfo, ChatArgs, ChatResult, ProviderEnv } from "./types.ts";
import { zodToJsonSchema, stripFences, formatIssues } from "./jsonschema.ts";
import {
  ConfigError,
  HttpError,
  ValidationError,
  TEXT_TIMEOUT_MS,
  VISION_TIMEOUT_MS,
  toMessages,
  appendRetryMessage,
  postJson,
  readContent,
  readUsage,
} from "./http.ts";

const DEFAULT_BASE_URL = "https://api.meta.ai";
const MODEL = "muse-spark-1.3";
const MAX_IMAGES = 50;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

/**
 * Dev/eval-only base override, honored ONLY with ALLOW_URL_OVERRIDE=1.
 * The override is an origin (scheme+host+port); /v1/chat/completions is
 * appended here, so the default always resolves to exactly
 * https://api.meta.ai/v1/chat/completions with no doubled segments.
 */
function chatUrl(env: ProviderEnv): string {
  const base =
    env.ALLOW_URL_OVERRIDE === "1" && env.META_BASE_URL
      ? env.META_BASE_URL.replace(/\/+$/, "")
      : DEFAULT_BASE_URL;
  return `${base}/v1/chat/completions`;
}

/** Meta Model API, primary. Strict JSON-schema mode. Live calls only. */
export async function chatMeta<S extends z.ZodTypeAny>(
  args: ChatArgs<S>,
  env: ProviderEnv,
  opts?: { signal?: AbortSignal },
): Promise<ChatResult<z.infer<S>>> {
  const key = env.MODEL_API_KEY;
  if (!key) throw new ConfigError("MODEL_API_KEY is missing");
  const images = args.images ?? [];
  if (images.length > MAX_IMAGES) {
    throw new ConfigError(`meta accepts up to ${MAX_IMAGES} images, got ${images.length}`);
  }
  for (const img of images) {
    const bytes = Math.ceil((img.b64.length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) {
      throw new ConfigError(`meta image exceeds 50 MB (${bytes} bytes)`);
    }
  }
  const timeoutMs = args.timeoutMs ?? (images.length > 0 ? VISION_TIMEOUT_MS : TEXT_TIMEOUT_MS);
  const jsonSchema = zodToJsonSchema(args.schema);
  const name = args.name ?? "response";
  const base = {
    model: MODEL,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: { name, strict: true, schema: jsonSchema },
    },
  };

  const t0 = Date.now();
  const url = chatUrl(env);
  let messages = toMessages(args.system, args.user, images);
  const attempts: AttemptInfo[] = [];
  let lastDetail = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) messages = appendRetryMessage(messages, lastDetail);
    const { status, json } = await postJson(url, key, { ...base, messages }, timeoutMs, opts?.signal);
    if (status !== 200) {
      throw new HttpError(status, `meta chat failed with status ${status}`);
    }
    const usage = readUsage(json);
    try {
      const raw = stripFences(readContent(json));
      const parsed: unknown = JSON.parse(raw);
      const validated = args.schema.safeParse(parsed);
      if (!validated.success) {
        lastDetail = formatIssues(validated.error);
        attempts.push({ usage, error: lastDetail.slice(0, 200) });
        if (attempt === 1) throw new ValidationError(`meta: ${lastDetail}`);
        continue;
      }
      attempts.push({ usage });
      return {
        data: validated.data as z.infer<S>,
        raw,
        provider: "meta",
        latencyMs: Date.now() - t0,
        retries: attempt,
        usage,
        attempts,
      };
    } catch (e) {
      if (e instanceof ValidationError && attempt === 0) {
        lastDetail = e.message;
        attempts.push({ usage, error: lastDetail.slice(0, 200) });
        continue;
      }
      if (e instanceof SyntaxError) {
        lastDetail = "response was not valid JSON";
        if (attempt === 0) {
          attempts.push({ usage, error: lastDetail });
          continue;
        }
        throw new ValidationError(`meta: ${lastDetail}`);
      }
      throw e;
    }
  }
  throw new ValidationError(`meta: ${lastDetail || "validation failed"}`);
}
