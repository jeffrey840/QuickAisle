import { z } from "zod";

/**
 * POST /ingest contract, shared by the server route and scripts/ingest-try.ts.
 * Map photo → aisle/department/entrance layout on a 0–1000 image grid.
 *
 * Strict-JSON subset only (object/array/string/enum — no tuples, unions,
 * records, or optionals). Refinements (.length/.min) are enforced by Zod
 * at validation time.
 */

const Box = z.array(z.number()).length(4);

export const IngestAisle = z.object({
  /** aisle number as printed, e.g. "13" or "13A" */
  n: z.string(),
  orientation: z.enum(["vertical", "horizontal"]),
  /** [x0, y0, x1, y1] on a 0–1000 grid of the image */
  box: Box,
  /** item labels written along that aisle, in reading order */
  items: z.array(z.string()),
});
export type IngestAisleData = z.infer<typeof IngestAisle>;

export const IngestDepartment = z.object({
  name: z.string(),
  box: Box,
});

export const IngestEntrance = z.object({
  box: Box,
  kind: z.enum(["entrance", "exit", "both"]),
});

export const IngestSchema = z.object({
  aisles: z.array(IngestAisle).min(1),
  departments: z.array(IngestDepartment),
  entrances: z.array(IngestEntrance),
  notes: z.array(z.string()),
});
export type IngestData = z.infer<typeof IngestSchema>;

export interface IngestPromptDef {
  version: string;
  system: string;
  user: string;
}

export const INGEST_PROMPT: IngestPromptDef = {
  version: "ingest-v1",
  system:
    "You read grocery store maps into structured data. Report only what " +
    "is printed on the map — never invent an aisle, item, or department.",
  user:
    "Read this store map. Coordinates use a 0–1000 grid: x grows left to " +
    "right, y grows top to bottom, (0,0) is the top-left corner of the image. " +
    'Return JSON only: {"aisles": [{"n": <number as printed>, "orientation": ' +
    '<vertical|horizontal>, "box": [x0,y0,x1,y1], "items": [<labels along the aisle>]}], ' +
    '"departments": [{"name": <name>, "box": [x0,y0,x1,y1]}], ' +
    '"entrances": [{"box": [x0,y0,x1,y1], "kind": <entrance|exit|both>}], ' +
    '"notes": [<uncertainties>]}. ' +
    "Rules: aisles are NUMBERED SHOPPING aisles only — ignore parking and " +
    "curbside numbers, counter letters (A/B/C/D), lease spaces, restrooms, " +
    "the business center, and the drive-thru. " +
    "Copy the aisle number exactly as printed (including letter suffixes " +
    'like "13A"). Orientation follows the long axis: taller than wide is ' +
    "vertical, wider than tall is horizontal. " +
    "List the item labels written along each aisle in reading order, copied " +
    "as printed. Departments only if their name is printed on the map. " +
    "Put anything uncertain in notes, never in the structured fields.",
};
