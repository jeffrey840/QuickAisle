import { z } from "zod";
import { ReadListResponse } from "@quickaisle/schema";

/**
 * POST /read-list contract, shared by the server route and the T4 eval so
 * accuracy tests exercise the real prompt + schema.
 *
 * Reuses ReadListItem ({text, quantity?}) from @quickaisle/schema; the
 * `source` field is dropped (the caller knows the source) and a `notes`
 * array carries side annotations. Strict-JSON subset only (object/array
 * of string; quantity stays optional — Zod enforces, the converter
 * unwraps).
 */

export const ReadListSchema = ReadListResponse.omit({ source: true }).extend({
  notes: z.array(z.string()),
});
export type ReadListData = z.infer<typeof ReadListSchema>;

export interface ReadListPromptDef {
  version: string;
  system: string;
  user: string;
}

export const READLIST_PROMPT: ReadListPromptDef = {
  version: "readlist-v1",
  system:
    "You transcribe grocery lists into structured data. Read exactly what " +
    "is written — items, quantities, and side notes — and nothing else.",
  user:
    "Read every item on this shopping list. " +
    'Return JSON only: {"items": [{"text": <whole item exactly as written>, "quantity": <quantity part or "">}], ' +
    '"notes": [<side annotations>]}. ' +
    '"text" is the whole item exactly as written, INCLUDING any quantity ("2 doz eggs", "Cheerios x2"); ' +
    '"quantity" copies out just the quantity part, or "" when there is none. ' +
    "Rules: transcribe each item VERBATIM, keeping the writer's spelling, " +
    'abbreviations and quantities — do not correct "cerial" or expand "TP". ' +
    "One entry per item; split items separated by commas, pipes or columns. " +
    "SKIP crossed-out or struck-through items, headings and titles " +
    '(e.g. "TACO NIGHT", "LEFT:"), and printed paper labels ' +
    '(e.g. "MAGNETIC NOTEPAD"). ' +
    'Put side annotations (e.g. "<- check price") in notes, not in the item text. ' +
    'Never add items that are not written on the list (no guessing what "ice" means).',
};
