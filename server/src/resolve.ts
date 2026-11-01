import { normalize } from "@quickaisle/matching";
import { HEB_CATALOG, HEB_STORE_ID } from "./catalogs/heb-001.ts";
import { chat, type ProviderEnv } from "./providers/index.ts";
import {
  RESOLVE_PROMPT,
  ResolveSchema,
  type CatalogEntry,
  type ResolveData,
} from "./resolve-contract.ts";

/**
 * POST /resolve: messy list terms → catalog matches.
 *
 * Catalog source: storeIds the server knows (heb-001) use the bundled
 * catalog and any client-sent catalog is ignored. Unknown storeIds
 * (future /ingest stores kept on the device) must send their own catalog.
 * Every returned productId is validated against the catalog used.
 */

export const MAX_TERMS = 30;
export const MAX_TERM_CHARS = 60;
export const MAX_CATALOG = 500;
export const MAX_NAME_CHARS = 80;
export const MAX_ID_CHARS = 40;
export const MAX_STOREID_CHARS = 40;
/** learnedAliases[] only carries confident, non-clarify top matches */
export const LEARN_CONFIDENCE = 0.85;
/** per-call text timeout for both providers (Meta text took 13–14s; §10) */
export const RESOLVE_TIMEOUT_MS = 30_000;
/** start the other provider if the primary hasn't answered within this long */
export const HEDGE_MS = 12_000;

export class Resolve400 extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "Resolve400";
  }
}

export interface ValidResolve {
  storeId: string;
  terms: string[];
  catalog: CatalogEntry[];
}

export function validateResolveRequest(body: unknown): ValidResolve {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Resolve400("body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (
    typeof b.storeId !== "string" ||
    !b.storeId.trim() ||
    b.storeId.length > MAX_STOREID_CHARS
  ) {
    throw new Resolve400(
      `storeId must be a non-empty string of at most ${MAX_STOREID_CHARS} chars`,
    );
  }
  const storeId = b.storeId.trim();
  if (!Array.isArray(b.terms) || b.terms.length === 0 || b.terms.length > MAX_TERMS) {
    throw new Resolve400(`terms must be an array of 1–${MAX_TERMS} strings`);
  }
  const terms = b.terms.map((t, i) => {
    if (typeof t !== "string" || !t.trim()) {
      throw new Resolve400(`terms[${i}] must be a non-empty string`);
    }
    const trimmed = t.trim();
    if (trimmed.length > MAX_TERM_CHARS) {
      throw new Resolve400(`terms[${i}] exceeds ${MAX_TERM_CHARS} chars`);
    }
    if (!normalize(trimmed)) {
      throw new Resolve400(`terms[${i}] has no searchable text`);
    }
    return trimmed;
  });
  if (storeId === HEB_STORE_ID) return { storeId, terms, catalog: HEB_CATALOG };
  if (!Array.isArray(b.catalog) || b.catalog.length === 0 || b.catalog.length > MAX_CATALOG) {
    throw new Resolve400(
      `unknown storeId "${storeId}": include catalog with 1–${MAX_CATALOG} products`,
    );
  }
  const catalog = b.catalog.map((c, i) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      throw new Resolve400(`catalog[${i}] must be {id, name}`);
    }
    const { id, name } = c as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || id.length > MAX_ID_CHARS) {
      throw new Resolve400(`catalog[${i}].id must be 1–${MAX_ID_CHARS} chars`);
    }
    if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_CHARS) {
      throw new Resolve400(`catalog[${i}].name must be 1–${MAX_NAME_CHARS} chars`);
    }
    return { id: id.trim(), name: name.trim() };
  });
  return { storeId, terms, catalog };
}

export interface CleanAnswer {
  input: string;
  matches: Array<{ productId: string; confidence: number }>;
  needsClarification: boolean;
  question: string;
  options: string[];
}

export interface LearnedAliasOut {
  term: string;
  productId: string;
  confidence: number;
}

/**
 * Drop productIds not in the catalog. An answer whose matches were ALL
 * invented becomes needsClarification; an honest empty answer (not sold)
 * is left alone. learnedAliases carries confident non-clarify top
 * matches only — the app saves them to device storage.
 */
export function cleanAnswers(
  data: ResolveData,
  catalog: CatalogEntry[],
): { answers: CleanAnswer[]; learnedAliases: LearnedAliasOut[] } {
  const ids = new Set(catalog.map((c) => c.id));
  const answers: CleanAnswer[] = [];
  const learnedAliases: LearnedAliasOut[] = [];
  const seenTerms = new Set<string>();
  for (const a of data.answers) {
    const matches = a.matches.filter((m) => ids.has(m.productId));
    const rejectedAll = a.matches.length > 0 && matches.length === 0;
    const clarify = a.needsClarification || rejectedAll;
    answers.push({
      input: a.input,
      matches,
      needsClarification: clarify,
      question:
        clarify && !a.needsClarification
          ? "I couldn't match this confidently."
          : a.question,
      options: a.options,
    });
    const top = matches[0];
    const term = normalize(a.input);
    if (
      !clarify &&
      top &&
      top.confidence >= LEARN_CONFIDENCE &&
      term &&
      !seenTerms.has(term)
    ) {
      seenTerms.add(term);
      learnedAliases.push({ term, productId: top.productId, confidence: top.confidence });
    }
  }
  return { answers, learnedAliases };
}

export interface ResolveOk {
  status: 200;
  json: {
    answers: CleanAnswer[];
    learnedAliases: LearnedAliasOut[];
    provider: string;
    fallbackReason?: string;
  };
  /** counts only — never full terms */
  log: string;
}

export async function handleResolve(body: unknown, env: ProviderEnv): Promise<ResolveOk> {
  const { storeId, terms, catalog } = validateResolveRequest(body);
  const res = await chat(
    {
      system: RESOLVE_PROMPT.system,
      user: RESOLVE_PROMPT.user(terms, catalog),
      schema: ResolveSchema,
      name: "resolve_terms",
      timeoutMs: RESOLVE_TIMEOUT_MS,
    },
    env,
    undefined,
    { primary: "baseten", authFallback: true, hedgeMs: HEDGE_MS },
  );
  const { answers, learnedAliases } = cleanAnswers(res.data, catalog);
  const matched = answers.filter((a) => !a.needsClarification && a.matches.length > 0).length;
  const clarify = answers.filter((a) => a.needsClarification).length;
  const log =
    `[resolve] store=${storeId} terms=${terms.length} matched=${matched} ` +
    `clarify=${clarify} provider=${res.provider} latencyMs=${res.latencyMs} ` +
    `retries=${res.retries}` +
    (res.fallbackReason ? ` reason=${res.fallbackReason}` : "");
  return {
    status: 200,
    json: {
      answers,
      learnedAliases,
      provider: res.provider,
      ...(res.fallbackReason ? { fallbackReason: res.fallbackReason } : {}),
    },
    log,
  };
}
