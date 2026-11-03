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

export interface IngestDraftWire {
  runsOk: number;
  lowConfidence: boolean;
  aisles: Array<{
    n: string;
    orientation: "vertical" | "horizontal";
    box: [number, number, number, number];
    items: string[];
    agreement: number;
    itemsView?: "original" | "rotated";
  }>;
  departments: Array<{ name: string; box: [number, number, number, number]; agreement: number }>;
  entrances: Array<{
    box: [number, number, number, number];
    kind: "entrance" | "exit" | "both";
    agreement: number;
  }>;
  notes: string[];
  provider: string;
}

/** Friendly message for an /ingest HTTP failure. Pure, so tests can pin it. */
export function ingestErrorForStatus(status: number): string {
  if (status === 413) return "That map photo is too big — try a smaller one.";
  if (status === 502) return "Couldn't read this map — try a sharper photo.";
  if (status === 400) return "That file isn't a map photo we can read.";
  return `Couldn't read the map (server said ${status}) — try again.`;
}

/** POST /ingest with a client timeout. Throws a friendly Error on any failure. */
export async function postIngest(
  apiUrl: string,
  image: ReadListImage,
  timeoutMs = 90_000,
  rotated?: ReadListImage,
): Promise<IngestDraftWire> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rotated ? { image, rotated } : { image }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(ingestErrorForStatus(res.status));
    const json = (await res.json()) as Partial<IngestDraftWire>;
    if (!json || !Array.isArray(json.aisles) || json.aisles.length === 0) {
      throw new Error("Couldn't read this map — try a sharper photo.");
    }
    return json as IngestDraftWire;
  } finally {
    clearTimeout(timer);
  }
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
  catalog?: Array<{ id: string; name: string }>,
): Promise<ResolveResponseWire> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(catalog ? { storeId, terms, catalog } : { storeId, terms }),
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
