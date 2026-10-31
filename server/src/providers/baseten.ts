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

const URL = "https://inference.baseten.co/v1/chat/completions";
const MODEL = "meta-models/muse-spark-open-1026";
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Baseten (Meta open-weights), backup. No JSON mode: the prompt demands
 * JSON-only output, fences are stripped, then the text is parsed and
 * Zod-validated, with one retry carrying the validation error.
 * Reads ONLY choices[0].message.content; reasoning_content is ignored.
 */
export async function chatBaseten<S extends z.ZodTypeAny>(
  args: ChatArgs<S>,
  env: ProviderEnv,
): Promise<ChatResult<z.infer<S>>> {
  const key = env.BASETEN_API_KEY;
  if (!key) throw new ConfigError("BASETEN_API_KEY is missing");
  const images = args.images ?? [];
  if (images.length > MAX_IMAGES) {
    throw new ConfigError(`baseten accepts up to ${MAX_IMAGES} images, got ${images.length}`);
  }
  for (const img of images) {
    const bytes = Math.ceil((img.b64.length * 3) / 4);
    if (bytes > MAX_IMAGE_BYTES) {
      throw new ConfigError(`baseten image exceeds 10 MB (${bytes} bytes)`);
    }
  }
  const timeoutMs = images.length > 0 ? VISION_TIMEOUT_MS : TEXT_TIMEOUT_MS;
  const jsonSchema = zodToJsonSchema(args.schema);
  const user =
    `${args.user}\n\nRespond with JSON ONLY (no markdown fences, no commentary) ` +
    `matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const base = {
    model: env.BASETEN_MODEL || MODEL,
    reasoning_effort: "low",
    max_tokens: 8000,
  };

  const t0 = Date.now();
  let messages = toMessages(args.system, user, images);
  const attempts: AttemptInfo[] = [];
  let lastDetail = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) messages = appendRetryMessage(messages, lastDetail);
    const { status, json } = await postJson(URL, key, { ...base, messages }, timeoutMs);
    if (status !== 200) {
      throw new HttpError(status, `baseten chat failed with status ${status}`);
    }
    const usage = readUsage(json);
    try {
      const raw = stripFences(readContent(json));
      const parsed: unknown = JSON.parse(raw);
      const validated = args.schema.safeParse(parsed);
      if (!validated.success) {
        lastDetail = formatIssues(validated.error);
        attempts.push({ usage, error: lastDetail.slice(0, 200) });
        if (attempt === 1) throw new ValidationError(`baseten: ${lastDetail}`);
        continue;
      }
      attempts.push({ usage });
      return {
        data: validated.data as z.infer<S>,
        raw,
        provider: "baseten",
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
        throw new ValidationError(`baseten: ${lastDetail}`);
      }
      throw e;
    }
  }
  throw new ValidationError(`baseten: ${lastDetail || "validation failed"}`);
}
