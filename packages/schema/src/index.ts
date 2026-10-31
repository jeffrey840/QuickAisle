import { z } from "zod";

// ---------- store.json ----------

export const NodeType = z.enum(["entrance", "exit", "junction", "counter"]);
export type NodeType = z.infer<typeof NodeType>;

export const StoreNode = z.object({
  id: z.string(),
  xy: z.tuple([z.number(), z.number()]),
  type: z.union([NodeType, z.string()]).transform((v) => v as string),
});
export type StoreNode = z.infer<typeof StoreNode>;

export const StoreEdge = z.object({
  a: z.string(),
  b: z.string(),
  len: z.number().positive(),
});
export type StoreEdge = z.infer<typeof StoreEdge>;

export const StoreLocation = z.object({
  id: z.string(),
  edge: z.tuple([z.string(), z.string()]),
  t: z.number().min(0).max(1),
  side: z.enum(["L", "R", "C"]).default("C"),
});
export type StoreLocation = z.infer<typeof StoreLocation>;

export const ProductTag = z.enum([
  "cold",
  "frozen",
  "heavy",
  "fragile",
  "hot",
  "service",
]);
export type ProductTag = z.infer<typeof ProductTag>;

export const StoreProduct = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  locations: z.array(z.string()).min(1),
  tags: z.array(ProductTag).default([]),
  aisleLabel: z.string().optional(),
});
export type StoreProduct = z.infer<typeof StoreProduct>;

export const StoreService = z.object({
  id: z.string(),
  node: z.string(),
  mode: z.enum(["dropoff_pickup", "single"]),
});
export type StoreService = z.infer<typeof StoreService>;

export const StoreDoc = z.object({
  storeId: z.string(),
  version: z.number(),
  mapImage: z.string(),
  imageSize: z.tuple([z.number(), z.number()]),
  nodes: z.array(StoreNode),
  edges: z.array(StoreEdge),
  locations: z.array(StoreLocation),
  products: z.array(StoreProduct),
  services: z.array(StoreService).default([]),
});
export type StoreDoc = z.infer<typeof StoreDoc>;

// ---------- LLM I/O ----------

export const ResolveMatch = z.object({
  productId: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ResolveMatch = z.infer<typeof ResolveMatch>;

export const ResolveResponse = z.object({
  input: z.string(),
  matches: z.array(ResolveMatch),
  needsClarification: z.boolean(),
  question: z.string().optional(),
  tags: z.array(ProductTag).default([]),
});
export type ResolveResponse = z.infer<typeof ResolveResponse>;

export const ReadListItem = z.object({
  text: z.string(),
  quantity: z.string().optional(),
});
export type ReadListItem = z.infer<typeof ReadListItem>;

export const ReadListResponse = z.object({
  items: z.array(ReadListItem),
  source: z.enum([
    "handwritten",
    "screenshot",
    "recipe",
    "product",
    "pantry",
  ]),
});
export type ReadListResponse = z.infer<typeof ReadListResponse>;

export const IngestDirectoryRow = z.object({
  name: z.string(),
  aisle: z.string(),
});
export type IngestDirectoryRow = z.infer<typeof IngestDirectoryRow>;
