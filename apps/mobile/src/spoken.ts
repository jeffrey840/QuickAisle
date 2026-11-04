/**
 * Split a punctuation-free voice transcript into list items. Voice has no
 * commas, so "eggs milk coffee" would parse as one item — match the
 * longest spans against the store's product names/aliases first.
 * Pure; the matcher downstream still handles plurals and typos.
 */
export function splitSpoken(text: string, phrases: string[]): string[] {
  if (/[,;\n]/.test(text)) return [text];
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  const known = new Set<string>();
  for (const p of phrases) {
    const n = p.toLowerCase().trim();
    if (n) known.add(n);
  }
  // A span matches a phrase exactly, or ± one trailing "s".
  const matches = (span: string): boolean => {
    if (known.has(span)) return true;
    if (span.endsWith("s") && known.has(span.slice(0, -1))) return true;
    if (known.has(span + "s")) return true;
    return false;
  };
  const items: string[] = [];
  const push = (item: string): void => {
    if (items.length === 0 || items[items.length - 1] !== item) items.push(item);
  };
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) {
      push(pending.join(" "));
      pending = [];
    }
  };
  let i = 0;
  while (i < words.length) {
    if (words[i] === "and") {
      flush();
      i++;
      continue;
    }
    let len = 0;
    for (let k = Math.min(4, words.length - i); k >= 1; k--) {
      const span = words.slice(i, i + k);
      if (span.includes("and")) continue;
      if (matches(span.join(" "))) {
        len = k;
        break;
      }
    }
    if (len > 0) {
      flush();
      push(words.slice(i, i + len).join(" "));
      i += len;
    } else {
      pending.push(words[i]!);
      i++;
    }
  }
  flush();
  return items;
}
