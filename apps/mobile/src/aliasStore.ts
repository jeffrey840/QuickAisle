import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AliasStore, LearnedAlias } from "@quickaisle/matching";

type Blob = Record<string, LearnedAlias>;
const keyFor = (storeId: string): string => `quickaisle:aliases:${storeId}`;

async function readBlob(storeId: string): Promise<Blob> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(storeId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Blob;
  } catch {
    return {};
  }
}

async function writeBlob(storeId: string, blob: Blob): Promise<void> {
  await AsyncStorage.setItem(keyFor(storeId), JSON.stringify(blob));
}

/** Device-only AliasStore: one JSON blob per storeId, works offline. */
export const deviceAliases: AliasStore = {
  get: async (storeId, term) => (await readBlob(storeId))[term] ?? null,
  save: async (storeId, term, productId, confidence) => {
    const blob = await readBlob(storeId);
    blob[term] = { productId, confidence, ts: Date.now() };
    await writeBlob(storeId, blob);
  },
};

/** Save a batch of learned aliases in a single write. */
export async function saveLearnedAliases(
  storeId: string,
  list: Array<{ term: string; productId: string; confidence: number }>,
): Promise<void> {
  if (list.length === 0) return;
  const blob = await readBlob(storeId);
  const ts = Date.now();
  for (const a of list) {
    blob[a.term] = { productId: a.productId, confidence: a.confidence, ts };
  }
  await writeBlob(storeId, blob);
}
