import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { MAX_RESOLVE_BODY_CHARS, Resolve400, handleResolve } from "./resolve.ts";
import { MAX_READLIST_BODY_CHARS, ReadListError, handleReadList } from "./readlist.ts";
import { IngestError, MAX_BODY_CHARS, handleIngestText } from "./ingest.ts";
import { MAX_VOICE_BODY_CHARS, VoiceError, handleVoiceText } from "./voice.ts";
import { RATE_LIMITS, chargeUnits, type RateLimitKV } from "./ratelimit.ts";

type Bindings = {
  PRIMARY_PROVIDER?: string;
  MODEL_API_KEY?: string;
  BASETEN_API_KEY?: string;
  BASETEN_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  RATE_LIMIT?: RateLimitKV;
};

type AppContext = Context<{ Bindings: Bindings }>;

const app = new Hono<{ Bindings: Bindings }>();

const DEFAULT_ALLOWED_ORIGINS = "https://quickaisle.pages.dev,http://localhost:8081";

function allowedOrigin(origin: string, c: Context): string | null {
  if (!origin) return null; // no Origin (native app) — unaffected
  const listed = ((c.env as Bindings).ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (listed.includes(origin)) return origin;
  // Preview deploys of this project: https://<hash>.quickaisle.pages.dev.
  if (/^https:\/\/[a-z0-9-]+\.quickaisle\.pages\.dev$/i.test(origin)) return origin;
  return null;
}

app.use(
  "*",
  cors({
    origin: (origin, c) => allowedOrigin(origin, c),
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
    credentials: false,
  }),
);

/**
 * Pre-read body guard: Content-Length over the route cap → true (413
 * without reading). Missing or non-numeric headers → false here — the
 * after-read length check still catches those.
 */
export function contentLengthOverCap(header: string | undefined, cap: number): boolean {
  if (header === undefined) return false;
  const n = Number(header.trim());
  return Number.isFinite(n) && n > cap;
}

function clientIp(c: AppContext): string {
  const raw = c.req.header("CF-Connecting-IP")?.trim() || "";
  return raw ? raw.slice(0, 80) : "local"; // keep KV keys tiny
}

/**
 * Rate-limit charge (after the Content-Length check, before reading).
 * Returns a 429 response or null to proceed. KV failures fail CLOSED
 * (429) only when failClosed — /ingest burns 3–6 vision calls, too
 * expensive to give away when KV is down or its free write quota is hit;
 * the cheap routes fail open so the demo survives.
 */
async function chargeOr429(
  c: AppContext,
  units: number,
  failClosed: boolean,
): Promise<Response | null> {
  const ip = clientIp(c);
  try {
    const r = await chargeUnits(c.env.RATE_LIMIT, ip, units);
    if (!r.allowed) {
      return c.json({ error: RATE_LIMITS.message }, 429, {
        "Retry-After": String(r.retryAfterSec),
      });
    }
  } catch {
    if (failClosed) {
      return c.json({ error: RATE_LIMITS.message }, 429, { "Retry-After": "3600" });
    }
  }
  return null;
}

/** Content-Length gate + rate-limit charge, before reading any body. */
async function gateRequest(
  c: AppContext,
  capChars: number,
  units: number,
  failClosed: boolean,
): Promise<Response | null> {
  if (contentLengthOverCap(c.req.header("Content-Length"), capChars)) {
    return c.json({ error: "body too large" }, 413);
  }
  return chargeOr429(c, units, failClosed);
}

/**
 * True when the (unvalidated) body carries a second ingest view. A regex,
 * not a second JSON.parse of the ~8 MB body (Workers CPU limit) — quotes
 * never appear inside base64, so this is exact for real requests.
 */
export function hasRotatedView(text: string): boolean {
  return /"rotated"\s*:/.test(text);
}

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
  const gate = await gateRequest(c, MAX_RESOLVE_BODY_CHARS, RATE_LIMITS.units.resolve, false);
  if (gate) return gate;
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return c.json({ error: "body must be text" }, 400);
  }
  if (text.length > MAX_RESOLVE_BODY_CHARS) {
    return c.json({ error: "body too large" }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
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
  const gate = await gateRequest(c, MAX_READLIST_BODY_CHARS, RATE_LIMITS.units.readList, false);
  if (gate) return gate;
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return c.json({ error: "body must be text" }, 400);
  }
  if (text.length > MAX_READLIST_BODY_CHARS) {
    return c.json({ error: "body too large" }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
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
  const gate = await gateRequest(c, MAX_BODY_CHARS, RATE_LIMITS.units.ingest, true);
  if (gate) return gate;
  let text: string;
  try {
    text = await c.req.text();
  } catch {
    return c.json({ error: "body must be text" }, 400);
  }
  if (text.length > MAX_BODY_CHARS) {
    return c.json({ error: "body too large" }, 413);
  }
  // Two-view top-up: the pre-read charge covered one view; a request
  // carrying `rotated` burns 3 more Meta reads, charged here — still
  // before any AI call. Exact accounting beats a Content-Length guess,
  // which mis-charges whenever the header is missing or lies. Requests
  // denied here keep the first 3 units charged — bounded, at the limit.
  if (hasRotatedView(text)) {
    const top = await chargeOr429(c, RATE_LIMITS.units.ingestRotatedTopup, true);
    if (top) return top;
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
  const gate = await gateRequest(c, MAX_VOICE_BODY_CHARS, RATE_LIMITS.units.voiceList, false);
  if (gate) return gate;
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
