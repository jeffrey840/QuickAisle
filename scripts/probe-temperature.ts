/**
 * ONE tiny text request to Meta muse-spark-1.3 with temperature: 0.2.
 * Answers: does the model accept temperature?
 * Prints only: HTTP status, parsed yes/no, error message if any.
 * Never prints the key or headers.
 *
 * Run: node scripts/probe-temperature.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { chatMeta } from "../server/src/providers/meta.ts";
import { HttpError } from "../server/src/providers/http.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Key loading mirrors eval/run.ts: server/.dev.vars, env wins.
const env: Record<string, string> = {};
const devVars = join(root, "server/.dev.vars");
if (existsSync(devVars)) {
  for (const line of readFileSync(devVars, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) env[m[1]!] = m[2];
  }
}
if (process.env.MODEL_API_KEY) env.MODEL_API_KEY = process.env.MODEL_API_KEY;

const ProbeSchema = z.object({ ok: z.boolean() });

try {
  const res = await chatMeta(
    {
      system: "Reply with JSON only.",
      user: 'Return {"ok": true}.',
      schema: ProbeSchema,
      name: "probe",
      temperature: 0.2,
    },
    env,
  );
  console.log(`status=200 parsed=${res.data.ok === true ? "yes" : "no"} temperature=accepted`);
} catch (e) {
  const status = e instanceof HttpError ? String(e.status) : "?";
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`status=${status} parsed=no temperature=rejected: ${msg}`);
}
