export interface ResolveAnswerWire {
  input: string;
  matches: Array<{ productId: string; confidence: number }>;
  needsClarification: boolean;
  question: string;
  options: string[];
}

export interface ResolveResponseWire {
  answers: ResolveAnswerWire[];
  learnedAliases: Array<{ term: string; productId: string; confidence: number }>;
  provider: string;
  fallbackReason?: string;
}

/**
 * Short parenthesized reason for a photo failure, for on-phone diagnosis.
 * Network failures map to fixed strings; anything else is the raw
 * name/message capped at 80 chars. Never image data.
 */
export function friendlyReason(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (/unknownhost|network request failed/i.test(raw)) return "(no internet connection)";
  if (/abort|timeout|timed out/i.test(raw)) return "(timed out)";
  return `(${raw.slice(0, 80)})`;
}

export interface ReadListImage {
  mime: string;
  b64: string;
}

export interface ReadListResponseWire {
  items: Array<{ text: string; quantity?: string }>;
  notes: string[];
  provider: string;
  fallbackReason?: string;
}

/** POST /read-list with a client timeout. Throws on any failure. */
export async function postReadList(
  apiUrl: string,
  storeId: string,
  image: ReadListImage,
  timeoutMs = 45_000,
): Promise<ReadListResponseWire> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/read-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, image }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`/read-list failed with status ${res.status}`);
    const json = (await res.json()) as Partial<ReadListResponseWire>;
    if (!json || !Array.isArray(json.items)) {
      throw new Error("bad /read-list response shape");
    }
    return {
      items: json.items,
      notes: Array.isArray(json.notes) ? json.notes : [],
      provider: typeof json.provider === "string" ? json.provider : "?",
      ...(typeof json.fallbackReason === "string"
        ? { fallbackReason: json.fallbackReason }
        : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** POST /resolve with a client timeout. Throws on any failure. */
export async function postResolve(
  apiUrl: string,
  storeId: string,
  terms: string[],
  timeoutMs = 60_000,
): Promise<ResolveResponseWire> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, terms }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`/resolve failed with status ${res.status}`);
    const json = (await res.json()) as Partial<ResolveResponseWire>;
    if (!json || !Array.isArray(json.answers)) {
      throw new Error("bad /resolve response shape");
    }
    return {
      answers: json.answers,
      learnedAliases: Array.isArray(json.learnedAliases) ? json.learnedAliases : [],
      provider: typeof json.provider === "string" ? json.provider : "?",
      ...(typeof json.fallbackReason === "string"
        ? { fallbackReason: json.fallbackReason }
        : {}),
    };
  } finally {
    clearTimeout(timer);
  }
}
