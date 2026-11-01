const UNITS = new Set([
  "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "g", "gram", "grams",
  "kg", "ml", "l", "liter", "liters", "ct", "count", "pk", "pack", "packs",
  "gal", "gallon", "gallons", "qt", "pint", "pints", "cup", "cups",
]);

/** lowercase, strip quantities/units/punctuation, naive singularize */
export function normalize(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/['']/g, "");
  const kept: string[] = [];
  for (const tok of s.split(/[^a-z0-9/+-]+/)) {
    if (!tok) continue;
    if (/^\d+(\.\d+)?$/.test(tok)) continue;
    if (/^\d+\s*(x|-)\s*\d+/.test(tok)) continue;
    if (UNITS.has(tok)) continue;
    kept.push(tok);
  }
  s = kept.join(" ").trim();
  return singularize(s);
}

function singularize(s: string): string {
  if (/(shoes|glasses|chips|nachos|oats)$/.test(s)) return s;
  if (s.endsWith("ies") && s.length > 4) return s.slice(0, -3) + "y";
  if (s.endsWith("ses") || s.endsWith("xes") || s.endsWith("zes")) return s.slice(0, -2);
  if (s.endsWith("s") && !s.endsWith("ss") && s.length > 3) return s.slice(0, -1);
  return s;
}
