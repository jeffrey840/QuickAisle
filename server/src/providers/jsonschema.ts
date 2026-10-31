import { z } from "zod";

/**
 * Minimal Zod (v3) → JSON Schema converter, restricted to the subset Meta's
 * strict JSON mode supports: object/array/string/number/boolean/enum.
 * Every object gets additionalProperties:false and all properties required.
 * Throws loudly on anything else (union, record, tuple, effects, …) — the
 * caller must keep request schemas inside this subset.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodDefault) {
    return zodToJsonSchema(schema._def.innerType);
  }
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodReadonly
  ) {
    // Strict mode requires every property anyway; Zod still enforces
    // optionality when the response is validated.
    return zodToJsonSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, sub] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(sub);
      required.push(key);
    }
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    };
  }
  if (schema instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: [...schema.options] };
  const typeName: string = (schema as z.ZodTypeAny)._def?.typeName ?? "unknown";
  throw new Error(
    `zodToJsonSchema: unsupported type ${typeName} — keep provider request schemas to object/array/string/number/boolean/enum`,
  );
}

/** Remove ```json … ``` / ``` … ``` wrappers models add despite instructions. */
export function stripFences(text: string): string {
  let t = text.trim();
  if (!t.startsWith("```")) return t;
  const end = t.lastIndexOf("```");
  if (end <= 3) return t;
  const firstNl = t.indexOf("\n");
  t = firstNl >= 0 ? t.slice(firstNl + 1, end) : "";
  return t.trim();
}

/** One-line-per-issue summary for the retry prompt. Capped, never the raw text. */
export function formatIssues(error: z.ZodError, cap = 1000): string {
  const s = error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return s.length > cap ? s.slice(0, cap) + "…" : s;
}
