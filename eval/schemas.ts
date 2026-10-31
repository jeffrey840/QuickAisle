import { z } from "zod";
import { IngestDirectoryRow } from "@quickaisle/schema";

/**
 * Eval request schemas. Kept inside the strict-JSON subset the provider
 * layer supports (object/array/string/number/boolean/enum — no tuples,
 * unions, or records) so the same schemas work on Meta strict mode and
 * on Baseten via the prompt-embedded JSON Schema.
 */

export const T1Schema = z.object({
  rows: z.array(IngestDirectoryRow).min(1),
});
export type T1Data = z.infer<typeof T1Schema>;

const Xy = z.array(z.number()).length(2);

export const T2Schema = z.object({
  aisles: z.array(
    z.object({
      n: z.number(),
      x: z.number(),
      yTop: z.number(),
      yBot: z.number(),
    }),
  ).min(1),
  departments: z.array(
    z.object({ name: z.string(), xy: Xy }),
  ).min(1),
  entrances: z.array(
    z.object({ xy: Xy }),
  ),
});
export type T2Data = z.infer<typeof T2Schema>;
