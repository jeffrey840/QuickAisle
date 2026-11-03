import { Hono } from "hono";
import { Resolve400, handleResolve } from "./resolve.ts";
import { ReadListError, handleReadList } from "./readlist.ts";
import { IngestError, MAX_BODY_CHARS, handleIngestText } from "./ingest.ts";
import { MAX_VOICE_BODY_CHARS, VoiceError, handleVoiceText } from "./voice.ts";

type Bindings = {
  PRIMARY_PROVIDER?: string;
  MODEL_API_KEY?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    day: 1,
    primary: c.env.PRIMARY_PROVIDER ?? "meta",
    // presence only — never values, lengths, or prefixes
    hasModelKey: !!c.env.MODEL_API_KEY,
    hasBasetenKey: !!c.env.BASETEN_API_KEY,
  }),
);

app.post("/resolve", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  try {
    const out = await handleResolve(body, c.env);
    console.log(out.log);
    return c.json(out.json);
  } catch (e) {
    if (e instanceof Resolve400) return c.json({ error: e.message }, 400);
    throw e;
  }
});

app.post("/read-list", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  try {
    const out = await handleReadList(body, c.env);
    console.log(out.log);
    return c.json(out.json);
  } catch (e) {
    if (e instanceof ReadListError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

app.post("/ingest", async (c) => {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return c.json({ error: "body must be text" }, 400);
  }
  if (text.length > MAX_BODY_CHARS) {
    return c.json({ error: "body too large" }, 413);
  }
  try {
    const out = await handleIngestText(text, c.env);
    console.log(out.log);
    return c.json(out.json);
  } catch (e) {
    if (e instanceof IngestError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

app.post("/voice-list", async (c) => {
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return c.json({ error: "body must be text" }, 400);
  }
  if (text.length > MAX_VOICE_BODY_CHARS) {
    return c.json({ error: "body too large" }, 413);
  }
  try {
    const out = await handleVoiceText(text, c.env);
    console.log(out.log);
    return c.json(out.json);
  } catch (e) {
    if (e instanceof VoiceError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

// Day 4: POST /explain — route recap text (never changes the route)

export default app;
