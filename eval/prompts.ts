/**
 * Versioned eval prompts. Bump `version` whenever the wording changes and
 * re-run the eval — prompt text is part of the measured system.
 */

export const T1_PROMPT = {
  version: "t1-v1",
  system:
    "You extract structured data from photos of a grocery store directory sign. " +
    "Read carefully and transcribe exactly what is printed, including any errors " +
    "in the original. Never invent rows.",
  user:
    "Read every row of this store directory. " +
    'Return JSON only: {"rows": [{"name": <item name exactly as printed>, ' +
    '"aisle": <aisle exactly as printed>}]}. Include all rows in printed order.',
};

export const T2_PROMPT = {
  version: "t2-v1",
  system:
    "You read grocery store floor-plan maps and report the aisle layout as " +
    "measured geometry. All coordinates are in image pixels. Never invent aisles.",
  user:
    "This store map image is 1268x1048 pixels. " +
    "Report: every numbered shopping aisle as {n, x walkway center, yTop shelf top, yBot shelf bottom}; " +
    "every named department (Produce, Bakery, Market Deli, Sushi, Seafood, Market, Milk, Eggs, " +
    "Dairy, Frozen Foods, Deli, Pharmacy, Floral, Checkstands) as {name, xy center}; " +
    "every entrance/exit as {xy}. " +
    'Return JSON only: {"aisles": [...], "departments": [...], "entrances": [...]}.',
};
