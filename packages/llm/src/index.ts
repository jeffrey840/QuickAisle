/**
 * Shared LLM provider layer. Used by BOTH the server routes and eval/run.ts
 * so accuracy tests exercise the real code path (prompts included).
 *
 * Only Meta models are allowed in the product (judging Stage 1):
 * - "meta": Meta Model API (Muse Spark / vision / SAM 3.1)
 * - "baseten": Meta open-weights (Llama) via Baseten
 *
 * HTTP request shapes are written from each provider's docs — never guessed.
 * Until the owner supplies docs + keys, every call throws NotConfigured.
 */
import type {
  IngestDirectoryRow,
  ReadListResponse,
  ResolveResponse,
} from "@quickaisle/schema";

export type ProviderName = "meta" | "baseten";

export interface ProviderEnv {
  MODEL_API_KEY?: string;
  META_DOCS_URL?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
}

export class NotConfigured extends Error {
  constructor(provider: string) {
    super(
      `${provider} provider is not configured yet (need docs + key in server/.dev.vars). ` +
        `See HANDOFF_PLAN.md §9.`,
    );
    this.name = "NotConfigured";
  }
}

export interface CatalogEntry {
  id: string;
  name: string;
}

export interface LlmProvider {
  readonly name: ProviderName;
  /** T3 job: messy list terms → catalog products (strict JSON). */
  resolveItems(
    terms: string[],
    catalog: CatalogEntry[],
  ): Promise<{ answers: ResolveResponse[]; rawMs: number }>;
  /** T4 job: list/recipe photo → items (strict JSON). */
  readList(
    imageB64: string,
    mime: string,
  ): Promise<{ answer: ReadListResponse; rawMs: number }>;
  /** T1 job: directory photo → [{name, aisle}] (strict JSON). */
  readDirectory(
    imageB64: string,
    mime: string,
  ): Promise<{ rows: IngestDirectoryRow[]; rawMs: number }>;
  /** T2 job: map photo → aisle/department/entrance layout (strict JSON). */
  readMap(
    imageB64: string,
    mime: string,
  ): Promise<{ layout: MapLayout; rawMs: number }>;
}

export interface MapAisle {
  n: number;
  /** walkway x in image pixels */
  x: number;
  /** shelf top/bottom y in image pixels */
  yTop: number;
  yBot: number;
  split?: boolean;
}

export interface MapLayout {
  imageSize: [number, number];
  aisles: MapAisle[];
  departments: Array<{ name: string; xy: [number, number] }>;
  entrances: Array<{ xy: [number, number] }>;
}

export function getProvider(name: ProviderName, env: ProviderEnv): LlmProvider {
  if (name === "meta") return new MetaProvider(env);
  return new BasetenProvider(env);
}

class MetaProvider implements LlmProvider {
  readonly name = "meta" as const;
  private readonly env: ProviderEnv;
  constructor(env: ProviderEnv) {
    this.env = env;
  }
  private need(): never {
    throw new NotConfigured("meta (Meta Model API — need docs link + MODEL_API_KEY)");
  }
  async resolveItems(): Promise<{ answers: ResolveResponse[]; rawMs: number }> {
    this.need();
  }
  async readList(): Promise<{ answer: ReadListResponse; rawMs: number }> {
    this.need();
  }
  async readDirectory(): Promise<{ rows: IngestDirectoryRow[]; rawMs: number }> {
    this.need();
  }
  async readMap(): Promise<{ layout: MapLayout; rawMs: number }> {
    this.need();
  }
}

class BasetenProvider implements LlmProvider {
  readonly name = "baseten" as const;
  private readonly env: ProviderEnv;
  constructor(env: ProviderEnv) {
    this.env = env;
  }
  private need(): never {
    throw new NotConfigured("baseten (need model docs + BASETEN_API_KEY/BASETEN_MODEL)");
  }
  async resolveItems(): Promise<{ answers: ResolveResponse[]; rawMs: number }> {
    this.need();
  }
  async readList(): Promise<{ answer: ReadListResponse; rawMs: number }> {
    this.need();
  }
  async readDirectory(): Promise<{ rows: IngestDirectoryRow[]; rawMs: number }> {
    this.need();
  }
  async readMap(): Promise<{ layout: MapLayout; rawMs: number }> {
    this.need();
  }
}
