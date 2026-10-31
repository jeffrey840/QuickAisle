import { Hono } from "hono";

type Bindings = {
  PRIMARY_PROVIDER?: string;
  MODEL_API_KEY?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) =>
  c.json({ ok: true, day: 1, primary: c.env.PRIMARY_PROVIDER ?? "meta" }),
);

// Day 2: POST /resolve — messy terms → catalog matches (LLM + validation)
// Day 2: POST /read-list — list/recipe photo → items
// Day 3: POST /ingest — map + directory photos → draft store.json
// Day 4: POST /explain — route recap text (never changes the route)

export default app;
