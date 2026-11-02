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
/** One key per store: a whole SavedStore holds a ~200–400 KB map data URI,
 * and Android caps an AsyncStorage row at ~2 MB, so all stores in one key
 * would break after a few saves. The index stays tiny (ids only). */
const INDEX_KEY = "quickaisle:stores:index";
const storeKey = (id: string): string => `quickaisle:store:${id}`;
/** Pre-C2-fix single key, migrated on first access then removed. */
const LEGACY_KEY = "quickaisle:stores";
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

async function readIndex(kv: KV): Promise<string[]> {
  try {
    const raw = await kv.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Move the old single-blob key to per-store keys. Runs before every op;
 * a no-op once the legacy key is gone. Corrupt legacy data is dropped. */
async function migrate(kv: KV): Promise<void> {
  let raw: string | null;
  try {
    raw = await kv.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const ids: string[] = [];
      for (const [id, s] of Object.entries(parsed)) {
        if (isSavedStore(s) && s.id === id) {
          await kv.setItem(storeKey(id), JSON.stringify(s));
          ids.push(id);
        }
      }
      const prev = await readIndex(kv);
      await kv.setItem(INDEX_KEY, JSON.stringify([...ids, ...prev.filter((p) => !ids.includes(p))]));
    }
  } catch {
    // corrupt legacy blob: fall through to removal
  }
  try {
    await kv.removeItem(LEGACY_KEY);
  } catch {
    // leave it; next op retries
  }
}

async function readOne(kv: KV, id: string): Promise<SavedStore | null> {
  try {
    const raw = await kv.getItem(storeKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedStore(parsed) && parsed.id === id ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Saved-store repo over any KV backend. The built-in H-E-B lives in the
 * app bundle, not here — but save()/remove() refuse HEB_ID so callers
 * can't touch it by mistake, and list() callers must show it first.
 */
export function createStoreRepo(kv: KV) {
  return {
    /** Saved stores newest-first (H-E-B is NOT included; the app prepends it). */
    list: async (): Promise<SavedStore[]> => {
      await migrate(kv);
      const ids = await readIndex(kv);
      const out: SavedStore[] = [];
      const good: string[] = [];
      for (const id of ids) {
        const s = await readOne(kv, id);
        if (s) {
          out.push(s);
          good.push(id);
        }
      }
      if (good.length !== ids.length) {
        await kv.setItem(INDEX_KEY, JSON.stringify(good));
      }
      return out;
    },
    get: async (id: string): Promise<SavedStore | null> => {
      await migrate(kv);
      return readOne(kv, id);
    },
    save: async (s: SavedStore): Promise<void> => {
      if (s.id === HEB_ID) throw new Error("cannot overwrite the built-in store");
      if (!isSavedStore(s)) throw new Error("not a valid saved store");
      await migrate(kv);
      await kv.setItem(storeKey(s.id), JSON.stringify(s));
      const ids = (await readIndex(kv)).filter((x) => x !== s.id);
      await kv.setItem(INDEX_KEY, JSON.stringify([s.id, ...ids]));
    },
    remove: async (id: string): Promise<void> => {
      if (id === HEB_ID) throw new Error("cannot delete the built-in store");
      await migrate(kv);
      await kv.removeItem(storeKey(id));
      const ids = (await readIndex(kv)).filter((x) => x !== id);
      await kv.setItem(INDEX_KEY, JSON.stringify(ids));
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
