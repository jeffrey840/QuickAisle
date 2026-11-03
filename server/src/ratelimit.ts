/**
 * Demo rate limiting on Workers KV. Requests are charged "Meta-call units"
 * BEFORE any AI call: cheap text routes cost 1, vision routes more. Two
 * buckets: per client IP per hour, and one global bucket per UTC day.
 *
 * KV is NOT atomic: two concurrent requests can read the same count and
 * both admit, overshooting the quota by a few units under burst traffic.
 * That's fine for a demo limit — exactness isn't worth a Durable Object.
 */

/** Minimal KV surface we use; the real KVNamespace binding satisfies this. */
export interface RateLimitKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** All demo limits in one block. */
export const RATE_LIMITS = {
  /** Meta-call units charged per admitted request, before any AI call */
  units: {
    ingest: 3,
    /** extra charge after parsing when the request carries `rotated` (3+3) */
    ingestRotatedTopup: 3,
    readList: 2,
    resolve: 1,
    voiceList: 1,
  },
  ipUnitsPerHour: 40,
  globalUnitsPerDay: 400,
  /** one hour + margin so the bucket outlives its window */
  ipBucketTtlSec: 3700,
  /** 2 days — a day bucket must survive clock skew + late reads */
  globalBucketTtlSec: 172_800,
  message: "Demo limit reached — try again later or use the sample store",
} as const;

const num = (raw: string | null): number => {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** UTC-day bucket key, e.g. rl:day:2026-11-03. Exported for tests. */
export function dayKey(nowMs: number): string {
  return `rl:day:${new Date(nowMs).toISOString().slice(0, 10)}`;
}

/** Per-IP hour-bucket key. Exported for tests. */
export function ipKey(ip: string, nowMs: number): string {
  return `rl:ip:${ip}:${Math.floor(nowMs / 3_600_000)}`;
}

let missingBindingLogged = false;

export interface ChargeResult {
  allowed: boolean;
  /** seconds until the tripped bucket resets (0 when allowed) */
  retryAfterSec: number;
}

/**
 * Charge `units` against the IP-hour and global-day buckets. Rejected
 * requests are NOT charged. A missing binding (local dev, tests) allows
 * with a one-time log. KV failures PROPAGATE — the caller decides:
 * /ingest fails closed (3–6 vision calls are too expensive to give away),
 * cheap routes fail open so the demo survives KV quota exhaustion.
 */
export async function chargeUnits(
  kv: RateLimitKV | undefined,
  ip: string,
  units: number,
  nowMs: number = Date.now(),
): Promise<ChargeResult> {
  if (!kv) {
    if (!missingBindingLogged) {
      missingBindingLogged = true;
      console.log("[ratelimit] no RATE_LIMIT binding — allowing (local dev?)");
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  const [ipRaw, dayRaw] = await Promise.all([kv.get(ipKey(ip, nowMs)), kv.get(dayKey(nowMs))]);
  const ipCount = num(ipRaw);
  const dayCount = num(dayRaw);
  const hourResetSec = 3600 - Math.floor((nowMs / 1000) % 3600);
  const dayResetSec = 86400 - Math.floor((nowMs / 1000) % 86400);
  const ipOver = ipCount + units > RATE_LIMITS.ipUnitsPerHour;
  const dayOver = dayCount + units > RATE_LIMITS.globalUnitsPerDay;
  if (ipOver || dayOver) {
    return {
      allowed: false,
      retryAfterSec: Math.max(ipOver ? hourResetSec : 0, dayOver ? dayResetSec : 0),
    };
  }
  await Promise.all([
    kv.put(ipKey(ip, nowMs), String(ipCount + units), {
      expirationTtl: RATE_LIMITS.ipBucketTtlSec,
    }),
    kv.put(dayKey(nowMs), String(dayCount + units), {
      expirationTtl: RATE_LIMITS.globalBucketTtlSec,
    }),
  ]);
  return { allowed: true, retryAfterSec: 0 };
}
