/**
 * Transit-line area colors, derived from the stop's display name.
 * Case-insensitive whole words; first matching group wins.
 */

interface Area {
  label: string;
  color: string;
  words: RegExp;
}

const AREAS: Area[] = [
  { label: "Produce", color: "#00C389", words: /\b(produce|produces|fruit|fruits|veg|vegetable|vegetables)\b/i },
  { label: "Dairy", color: "#4DA3FF", words: /\b(dairy|dairies|milk|egg|eggs|cheese|cheeses)\b/i },
  { label: "Market", color: "#B07CFF", words: /\b(market|markets|meat|meats|deli|seafood|seafoods)\b/i },
  { label: "Pharmacy", color: "#FF9F43", words: /\b(pharmacy|pharmacies|rx)\b/i },
  { label: "Frozen", color: "#7FD3FF", words: /\bfrozen\b/i },
  { label: "Aisle", color: "#FF5B6E", words: /\baisles?\b/i },
];

const FALLBACK: Area = { label: "Aisle", color: "#FF5B6E", words: /$^/ };

function areaFor(name: string): Area {
  return AREAS.find((a) => a.words.test(name)) ?? FALLBACK;
}

/** Dot color for a stop display name. Pure. */
export function areaColor(name: string): string {
  return areaFor(name).color;
}

/** Legend label for a stop display name. Pure. */
export function areaLabel(name: string): string {
  return areaFor(name).label;
}
