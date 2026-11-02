import { StoreDoc, type StoreDoc as StoreDocType } from "@quickaisle/schema";
import type { DraftInput } from "@quickaisle/routing";

/** A user-saved store: the editable AI draft plus the built routable store. */
export interface SavedStore {
  id: string;
  name: string;
  createdAt: string;
  imageSize: [number, number];
  /** Resized JPEG data URI (long side ≤1400px) for the map background. */
  mapDataUri: string;
  draft: DraftInput & { notes?: string[]; lowConfidence?: boolean };
  store: StoreDocType;
}

/** Minimal key-value surface (AsyncStorage-compatible) so tests can inject a fake. */
export interface KV {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const HEB_ID = "heb-001";
const STORES_KEY = "quickaisle:stores";
const SELECTED_KEY = "quickaisle:selected-store";

export function newStoreId(): string {
  return `store-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function isSavedStore(x: unknown): x is SavedStore {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.mapDataUri === "string" &&
    Array.isArray(s.imageSize) &&
    !!s.draft &&
    typeof s.draft === "object" &&
    StoreDoc.safeParse(s.store).success
  );
}

async function readAll(kv: KV): Promise<Record<string, SavedStore>> {
  try {
    const raw = await kv.getItem(STORES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, SavedStore> = {};
    for (const [id, s] of Object.entries(parsed)) {
      if (isSavedStore(s) && s.id === id) out[id] = s;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Saved-store repo over any KV backend. The built-in H-E-B lives in the
 * app bundle, not here — but delete() refuses HEB_ID so callers can't
 * remove it by mistake, and list() callers must show it first.
 */
export function createStoreRepo(kv: KV) {
  return {
    /** Saved stores newest-first (H-E-B is NOT included; the app prepends it). */
    list: async (): Promise<SavedStore[]> => {
      const all = await readAll(kv);
      return Object.values(all).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    get: async (id: string): Promise<SavedStore | null> => (await readAll(kv))[id] ?? null,
    save: async (s: SavedStore): Promise<void> => {
      if (s.id === HEB_ID) throw new Error("cannot overwrite the built-in store");
      if (!isSavedStore(s)) throw new Error("not a valid saved store");
      const all = await readAll(kv);
      all[s.id] = s;
      await kv.setItem(STORES_KEY, JSON.stringify(all));
    },
    remove: async (id: string): Promise<void> => {
      if (id === HEB_ID) throw new Error("cannot delete the built-in store");
      const all = await readAll(kv);
      delete all[id];
      await kv.setItem(STORES_KEY, JSON.stringify(all));
      if ((await kv.getItem(SELECTED_KEY)) === id) {
        await kv.setItem(SELECTED_KEY, HEB_ID);
      }
    },
    selected: async (): Promise<string> => (await kv.getItem(SELECTED_KEY)) ?? HEB_ID,
    select: async (id: string): Promise<void> => {
      await kv.setItem(SELECTED_KEY, id);
    },
  };
}

export type StoreRepo = ReturnType<typeof createStoreRepo>;
