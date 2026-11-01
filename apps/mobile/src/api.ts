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
