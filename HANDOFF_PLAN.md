# QuickAisle — Build Plan (handoff)

> This file lives in the project root (`/Users/jeffreycabrerafigueroa/meta_hackathon/QuickAisle`).
> Store images: `data/stores/heb-001/map.png` and `directory.png`. Accuracy-test ground truth: `eval/` (§10).
> Hand-drawn reference routes for tests A and B: `eval/reference/test-a-route.png`, `test-b-route.png`.
> Everything a new session needs is in here.

---

## 0. What we're building (one paragraph)

An Android app (APK, sideloaded — no Play Store review needed) that takes a grocery list, works out the
shortest pickup order through a specific store, and draws the route on the store map with numbered stops.
Either entrance/exit may be used; the app picks the best pair. Cold/frozen items go last, heavy items early,
pharmacy drop-off first / pick-up last. Meta's AI models (1) read the list — typed, or a photo of a
handwritten list, screenshot, or recipe — and (2) turn photos of a *new* store's map + directory into the
store data automatically. Ships as an APK **and** a web link (same Expo codebase).

**Built for:** Meta Global AI Developer Hackathon (Cerebral Valley), **Indie developer track**,
theme **"Build for Your World."**
- Submissions due **Nov 4, 2026, 9:00 PM ET**. Judging Nov 4–8, finals Nov 9.
- Must use Meta's models: Meta Model API (Muse Spark, Muse Wonder, Muse Image, SAM 3.1) and/or Meta
  open-weights models (Llama) — here via **Baseten** (partner credits).
- Official judging and submission rules: see **§0a** — they drive every priority below.

**Timeline (today is Oct 30):** Day 1 = Oct 30, Day 2 = Oct 31 → working prototype. Day 3 = Nov 1
(Meta-AI hero feature), Day 4 = Nov 2–3 (live link, polish, repo), Day 5 = Nov 4 (video + submit).

---

## 0a. Judging & submission rules (from the official rules)

**Submission (due Nov 4, 9:00 PM ET — late = not considered; target submitting by noon Nov 4)**
- Submit via the Cerebral Valley submission page. One project; one "Representative" submits.
- **Public repository** — must be accessible publicly.
- **3-minute demo video** — link must be accessible. Must highlight the specific features, code, and
  functionality **built during the hackathon**. It is one of the primary artifacts judges use, along
  with the **code** and the **live product**.
- Everyone who worked on it listed on the submission page.

**Stage 1 — pass/fail:** fits the theme ("Build for Your World") **and** reasonably used Meta Model API
and/or Meta open-weight models. → The product must visibly depend on Meta models. **No non-Meta
models anywhere in the product.**

**Stage 2 — scored 0–10 per category**
| Category | Weight | What they ask | How this project wins it |
|---|---|---|---|
| **Impact** | 30% | Real-world potential, who benefits, could people actually use it, fits a problem statement | Frame for shoppers short on time, elderly/disabled shoppers, and curbside/delivery pickers. **Show a number:** distance/time saved vs. walking the list in typed order (§5 metric). Works for *any* store via photos. |
| **Use of Meta AI tooling** | 25% | Creative use, beyond basic integration, surprising capabilities | Hero feature: **photograph any store's map + directory → Meta vision model + SAM 3.1 build the walkable store graph** (§6 `/ingest`). Plus **snap a list**: photo of a handwritten list, screenshot, or recipe → items (Meta vision), and Muse Spark for messy text ("taco night", "headache stuff"). Show the AI's draft vs. the corrected result. |
| **Technical depth & execution** | 20% | Sound, refined engineering, real craft | AI only interprets; routing is an exact solver (Held–Karp) with constraints; schema-validated LLM output; provider fallback; offline-first; tests. Show this in the video and README. |
| **Demo** | 25% | Working, impressive, holds up live, video cool to watch | Real phone, real list, route animates on the map, then the photo-to-store moment. Never depends on a single API being up. |

**Stage 3:** top 5 per track → finalists' videos watched live and ranked with the same rubric. The
video is the product in the final — budget real time for it.

---

## 1. Hard rules for whoever builds this

1. **The AI never decides the route.** Models only (a) interpret list text into store product IDs,
   (b) read list/recipe photos into items, and (c) extract store data from map/directory photos.
   Ordering/routing is deterministic local code.
2. **No API keys in the APK or web build.** All model calls go through our server; keys are Cloudflare
   secrets (`wrangler secret put`) in production and `server/.dev.vars` (gitignored) locally.
3. **Don't guess the Meta Model API or Baseten request shapes.** Ask the owner for docs/keys and
   write calls from the docs. (These APIs are newer than the assistant's reliable knowledge.)
4. **Offline-first:** list → match → route → draw must work with no network using the bundled store data.
   AI is an enhancement with graceful fallback.
5. Ship the hand-built H-E-B store first so the core always works. The "add store from photos" feature
   is the **hero feature for judging** (Day 3), but the demo must still work if it misbehaves.
6. **Only Meta models in the product** (Meta Model API, or Meta open-weights via Baseten). Required to
   pass judging Stage 1.
7. **Public repo from day one:** no keys or secrets committed — `.dev.vars`/`.env` gitignored,
   `.dev.vars.example` checked in. Commit often; history shows the work was built during the hackathon.

---

## 2. Tech stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| App | **Expo (React Native) + TypeScript**, latest SDK | Test live with Expo Go (Play Store Expo Go only runs the latest SDK). APK via EAS Build. Same code exports to web |
| APK build | `eas build -p android --profile preview` with `"buildType": "apk"` | Free Expo account; install via QR/link; "Install unknown apps" on phone |
| Map drawing | `react-native-svg` over the map image, pinch-zoom | All coordinates in map image pixels |
| Local storage | Bundled `store.json` + a simple key-value store (AsyncStorage) for lists, learned aliases, saved stores | Must work on **web too** — avoid `expo-sqlite` (its web support needs extra setup) |
| Fuzzy match | Fuse.js (or trigram) | |
| Server | **TypeScript + Hono on Cloudflare Workers** | Shares packages with the app. Local: `wrangler dev --ip 0.0.0.0` and point the phone at the laptop's **LAN IP** (not localhost) |
| Server storage | **Workers KV** (free) | Learned aliases + per-device rate-limit counters. Uploaded photos are **not stored** — processed and discarded |
| AI providers | **Baseten** (Meta open-weights / Llama, OpenAI-compatible API — verify in docs) and **Meta Model API** (Muse Spark / vision / SAM 3.1) | Provider abstraction with fallback |
| Schema validation | Zod (shared) | Validate store.json and every LLM response |
| Hosting (all free) | **Cloudflare Workers** (server) · **Cloudflare Pages** (Expo web build = judges' live link) · **GitHub Releases** (APK) | Free plan, no credit card; Workers don't sleep, so no cold-start stalls in the demo. API keys stored with `wrangler secret put`, never in the repo. Local `wrangler dev` for Days 1–2 |

### 2a. Expo specifics

**How the app finds the server** — one public env var, different per environment:
| Where it runs | `EXPO_PUBLIC_API_URL` | Set in |
|---|---|---|
| Expo Go on the phone (Days 1–2) | `http://<laptop LAN IP>:8787` (`wrangler dev --ip 0.0.0.0`) | `apps/mobile/.env.local` (gitignored) |
| APK | `https://<worker>.workers.dev` | `eas.json` → build profile `env` |
| Web build on Pages | `https://<worker>.workers.dev` | env when running `npx expo export -p web` |

`EXPO_PUBLIC_*` values are **baked into the app and readable by anyone** — the server URL is fine,
**API keys never go here**. Baseten/Meta keys live only on the Worker.

**`apps/mobile/eas.json`**
```json
{
  "cli": { "appVersionSource": "local" },
  "build": {
    "preview": {
      "android": { "buildType": "apk" },
      "env": { "EXPO_PUBLIC_API_URL": "https://<worker>.workers.dev" }
    }
  }
}
```
A plain-HTTP LAN URL only works in Expo Go; the APK must use the HTTPS Worker URL (Android blocks
cleartext HTTP in release builds by default).

**Packages** (install with `npx expo install …` so versions match the SDK)
| Need | Package | Web? |
|---|---|---|
| Camera / photo picker for "Snap a list" and "Add a store" | `expo-image-picker` | ✅ file picker / phone camera |
| Shrink photos to ≤ 1600 px before upload | `expo-image-manipulator` | ✅ |
| Map + route drawing | `react-native-svg` | ✅ |
| Pinch-zoom / pan on the map | `react-native-gesture-handler` + `react-native-reanimated` | ✅ |
| Local storage | `@react-native-async-storage/async-storage` | ✅ (localStorage) |
| Screens | `expo-router` | ✅ |

**Monorepo:** recent Expo SDKs detect npm/pnpm workspaces automatically, so `apps/mobile` can import
`packages/routing`, `packages/matching`, `packages/schema` directly. Keep those packages plain
TypeScript with **no React Native or Node-only imports** — the same code runs in the app, the browser,
and the Cloudflare Worker.

**Expo commands, in order**
1. `npx create-expo-app@latest apps/mobile` → `npx expo start` → scan QR with Expo Go (Day 1)
2. `npm i -g eas-cli` → `eas login` → `eas build:configure` (Day 2)
3. `eas build -p android --profile preview` → install via QR (Day 2; upload the `.apk` to GitHub Releases on Day 4)
4. `npx expo export -p web` → `dist/` → deploy to Cloudflare Pages (Day 4)

### Repo layout
```
QuickAisle/
├─ apps/mobile/            # Expo app
├─ packages/schema/        # Zod schemas + types for store.json, LLM I/O
├─ packages/routing/       # graph, Dijkstra, Held–Karp, constraints  ← core
├─ packages/matching/      # normalize, alias, fuzzy
├─ server/                 # Hono on Cloudflare Workers: /resolve, /read-list, /ingest, /explain, /health (wrangler.toml)
├─ data/stores/heb-001/    # store.json, map.png, directory.png
├─ eval/                   # gold data, test cases, run.ts, results/  (see §10)
└─ scripts/validate-store.ts
```

---

## 3. Data model — `store.json`

```jsonc
{
  "storeId": "heb-001", "version": 1,
  "mapImage": "map.png", "imageSize": [1268, 1048],      // coords = image pixels
  "nodes": [ { "id": "ent_L", "xy": [387, 925], "type": "entrance|exit|junction|counter" } ],
  "edges": [ { "a": "ent_L", "b": "front_L", "len": 210 } ],  // len = pixel distance, computed by script
  "locations": [ { "id": "loc_pickles", "edge": ["a6_front","a6_back"], "t": 0.38, "side": "R" } ],
  "products": [
    { "id": "pickles", "name": "Pickles", "aliases": ["pickle","dill pickles"],
      "locations": ["loc_pickles"], "tags": [] }
    // tags: cold | frozen | heavy | fragile | hot | service
  ],
  "services": [ { "id": "pharmacy", "node": "pharm", "mode": "dropoff_pickup" } ]
}
```
- A product may have several locations (cheese: dairy wall + deli); the router picks the best one.
- `t` = fraction along the edge (0 = first node, 1 = second). Lets the router weigh "dip in and back out"
  vs "walk the full aisle".

---

## 4. Store geometry already worked out (H-E-B map, 1268×1048 px)

Hand-estimated from the map image — good enough to start, verify by overlaying on the map.
Item tags (cold/frozen/heavy/fragile/hot) for the 167 directory items can be pre-filled once with a Meta
model at build time, then spot-checked by hand.

**Entrances / exits** (both are entrance+exit)
- Left: (387, 925) — next to Deli/Floral
- Right: (598, 930) — middle of the front, left of IBC Bank. **Not** next to the Pharmacy.

**Walkways**
- Back walkway: y ≈ 210, x from ≈ 300 to ≈ 1182
- Front walkway (aisles 1–10): y ≈ 660; (aisles 11–15): y ≈ 685
- Front walkway below checkstands: y ≈ 830, x ≈ 620 → 1060 (to Pharmacy)
- Right-wall (Dairy) walkway: x ≈ 1182, y ≈ 180 → 745
- Entry path from left entrance avoids Floral: (387,925) → (387,835) → (300,800) → produce

**Aisle walkway x-positions** (from the triangle markers)

| Aisle | x | Aisle | x |
|---|---|---|---|
| 1 | 327 | 10 | 773 |
| 2 | 380 | 11 | 815 |
| 3 | 427 | 12 | 865 |
| 4 | 476 | 13 | 910 |
| 5 | 521 | 14 | 962 |
| 6 | 572 | 15 | 1015 |
| 7 | 622 | 16 | 1097 (between frozen cases) |
| 8 | 671 | 17 | ≈1172 |
| 9 | 723 | | |

- Aisles 1–10 run full depth: shelves y ≈ 245 → 620.
- Aisles 11–15 are split into a back half (y ≈ 225–445, "A") and front half (y ≈ 475–665, "B") with a
  cross walkway at y ≈ 460. That explains "13A/13B/14B" in the directory.
- Aisles 15–17 = Frozen Foods (cases at x ≈ 1035–1075 and 1117–1150).

**Departments / stops (approx.)**
| Place | xy | Place | xy |
|---|---|---|---|
| Produce (apples) | (250, 470) | Market / meat counter | (965, 175) |
| Water / charcoal / matches (ends of aisle-1 shelves) | (300, 630) | Sushi | (778, 212) |
| Bakery | (365, 110) | Seafood | (775, 140) |
| Market Deli | (580, 210) | Eggs (top of right wall) | (1182, 180) |
| Milk (top-right corner) | (1155, 95) | Dairy / cheese | (1182, 330) |
| Pharmacy | (1140, 840) | Deli (hot food) | (265, 875) |
| Checkstands | x 480–840, y 700–790 | Floral (obstacle) | (395, 750) |
| Diet Aids / Nutrition bars (end of 16) | (1060, 760) | Ice | at checkstands |

**Item positions confirmed from the map**
- Cereal: aisle 3, y ≈ 430 (left shelf, about halfway)
- Pickles: aisle 6, y ≈ 495 (right-hand shelf); Cookies: aisle 7, y ≈ 480 (left-hand shelf) — same shelf, back-to-back
- Razors / Shaving Needs: aisle 12, front half, y ≈ 560 (Men's Toiletries next door in 13)

**Directory vs map conflicts — rule: trust the map, flag in UI**
| Item | Directory | Map / resolution |
|---|---|---|
| Hispanic Foods | 5 | Goya (Hispanic brand) is in 4 on both — check 4 first, then 5 |
| Rice | 4 | 6 (map shows Rice on the aisle-6 shelf) |
| Pop Tarts | 10 | not on map; Toaster Pastries / Pastries are in 2 — check 2 |
| Hot Cocoa | 16 | 3 (next to coffee) — directory looks like a typo |
| Food Wrap/Containers | 20 (doesn't exist) | likely 14 (Bags/Wrap, Foil 14B) |
| Toothpicks | 19 (doesn't exist) | likely 13/14 — "ask staff" |
| Batteries | "End Cap" | endcaps near checkstands / aisle 14 |
| Charcoal, Matches, Water | "By Produce" | ends of aisle-1 shelves near left entrance |
| Seasonal Items | 10 | also "Seasonal Space" by Floral — ask |
| Nutritional Bars | "End of 16" | front end of aisle 16 |

**Multi-location items (need a picker or default):** cheese (dairy default / deli sliced), chicken
(market raw default / deli rotisserie / frozen), bread (aisle 2 packaged / bakery fresh), milk (fresh
default / aisle 5 canned-powdered), candy (7 / checkstands / seasonal), ice cream (frozen 15–17 → walk 16).

---

## 5. Routing engine (`packages/routing`)

1. Build graph from nodes/edges; insert each chosen location as a point on its edge (split at `t`).
2. Dijkstra from every entrance, exit, and stop → distance matrix + paths.
3. Order: **Held–Karp exact DP** for ≤ 12–15 stops, trying every (entrance, exit) pair;
   above that, nearest-neighbor + 2-opt.
4. Multi-location products: choose one location per product inside the search (or pre-pick nearest to
   the route, then improve).
5. Constraints as penalties / precedence:
   - frozen after everything non-frozen; cold late (penalty per stop after it)
   - heavy early, fragile late (soft)
   - `dropoff_pickup` services → two stops, drop-off first, pick-up after (soft min gap); if the user
     says "prescription is ready", single stop
   - `hot` and ice → last before exit
6. Output: ordered stops (with product, aisle, side, short instruction) + full polyline for drawing.
7. **Savings metric (for Impact + Demo):** also compute the walking distance of visiting the items in
   the order typed, from the nearest entrance. Show "X% shorter · ~Y min saved" (pixels → meters via a
   one-time scale: measure one aisle's real length, or assume ~25 m per full aisle).

### Acceptance tests (must reproduce these hand-made routes)
**Test A:** prescriptions, eggs, apples, cereal, cheese, chicken, razors
→ Left entrance → apples → cereal (dip into aisle 3, back out) → razors (walk UP aisle 12) → chicken
(market, back wall) → eggs (back-right corner) → cheese (down dairy wall) → pharmacy → right exit.
Variant: prescription not ready → right entrance, drop off at pharmacy first, same loop, pick up last.

**Test B:** cookies, pickles, water, sushi, frozen food
→ Left entrance → water → pickles (dip into aisle 6, back out) → cookies (walk UP all of aisle 7)
→ sushi (back wall) → frozen (walk DOWN aisle 16) → right exit.

Plus property tests: every stop visited once; frozen never before non-frozen; Held–Karp result equals
brute force on random ≤ 7-stop lists.

---

## 6. Matching (`packages/matching`) + AI (`server/`)

**Local pipeline**
1. normalize (lowercase, strip quantities/units, singularize)
2. exact alias hit → accept
3. fuzzy: score ≥ 0.85 accept ("cerial" → Cereal); 0.6–0.85 → AI or "did you mean"; < 0.6 → AI
4. still ambiguous / multi-location → in-app picker

**Server endpoints**
- `POST /resolve` — unresolved terms + compact catalog (ids + names) → strict JSON:
  `{ input, matches:[{productId, confidence}], needsClarification, question, tags }`.
  Server rejects any productId not in the catalog. Successful answers saved as new aliases.
- `POST /read-list` (**Day 2**) — a photo instead of typing. Meta vision model returns
  `{ items: [{ text, quantity? }], source: "handwritten|screenshot|recipe|product" }` (strict JSON, validated),
  then the items go through the same matching pipeline as typed text. Handles:
  - handwritten lists (paper, fridge note, whiteboard) — messy handwriting and misspellings
  - screenshots (text messages, notes apps)
  - recipes (cookbook page, recipe site) → ingredients only, skipping pantry staples (salt, oil,
    water) unless the user keeps them
  - a product or empty package → that product
  - *(stretch)* fridge/pantry photo → items that look low or missing
  Phone: opens the camera; desktop: file picker. Resize to ≤ 1600 px before upload.
- `POST /ingest` (**hero feature, Day 3**) — map + directory photos → draft store.json. Pipeline:
  1. Meta vision model reads the directory photo → `{item, aisle}` list (strict JSON, validated).
  2. SAM 3.1 segments the map photo → shelf/aisle shapes; walkways = the open space between them.
  3. Meta vision model labels the segments (aisle numbers, departments, entrances).
  4. Code builds nodes/edges from the shapes, runs `validate-store`, flags conflicts (like the
     Hot Cocoa / Rice / aisle 19–20 issues in §4).
  5. Review screen: overlay of the draft on the photo; user fixes anything wrong, then saves.
  Keep a recording of the AI's raw draft vs. the fixed result for the video.
- `POST /explain` (optional) — "why this order" text from the computed route (never changes it).
- `GET /health`

**Provider layer** (`server/src/providers/`; verified live Oct 31)
- Meta (primary): `POST https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3`,
  strict `json_schema` mode, `reasoning_effort: "low"`, ≤50 images (≤50 MB each).
- Baseten (backup): `POST https://inference.baseten.co/v1/chat/completions`,
  model `meta-models/muse-spark-open-1026`, prompted JSON (no JSON mode) + fence-strip
  + Zod + 1 retry, `reasoning_effort: "low"`, `max_tokens: 8000`, ≤8 images (≤10 MB each).
- `chat()` tries Meta, falls back to Baseten on timeout (15 s text / 45 s vision),
  429/5xx, network error, or schema validation still failing after 1 retry.
- Per-task policy: list/directory reading (T1-type, `/read-list`, `/resolve`) → Baseten;
  map ingest (T2-type, `/ingest`) → no fallback, clear error instead.
- Server route only: `authFallback` also falls back on Meta 401/403, so an expired key
  can't break the live demo. The eval runner never sets it — bad keys stay loud there.
- Dev/eval-only: `META_BASE_URL` override gated by `ALLOW_URL_OVERRIDE=1` (for
  `--fallback-test`); never set either in `wrangler.toml` or secrets.
- Keys only in Cloudflare secrets / `server/.dev.vars`. Both providers serve Meta
  models, so Stage 1 holds either way.

**Demo safety net:** a `DEMO_MODE` flag that replays saved model responses for the exact demo inputs
(the handwritten list, the recipe, the second store's photos). Live judging never hinges on an API
being up; record the video with live calls, keep the replay as backup.

**Biggest unknown — de-risk on Day 1:** whether SAM 3.1 / Meta vision via the Meta Model API return
usable shelf geometry from a store-map photo. Spend ~1 hour on Day 1 evening sending `map.png` to the API
and inspecting the output. If segmentation is weak, fall back to: vision model returns the aisle layout
as structure (aisle count, order, orientation, departments by wall) and code lays out a regular grid that
the user adjusts on the review screen. Either way `/ingest` ships.

---

## 7. App screens

1. **List** — type/paste, **or 📷 "Snap or upload a list"** (handwritten list, screenshot, recipe,
   product photo → `/read-list`); voice optional. Items become chips; unmatched highlighted. For a
   recipe, show "From recipe: Lasagna" with a checkbox per ingredient so the user can drop what they have.
2. **Clarify** — only when needed ("Cheese: sliced at deli or block from dairy?").
3. **Route** — map + blue route + numbered stops + start (green) / exit (red); pinch-zoom.
4. **Shop mode** — checklist in route order; ✓ advances highlight; "Can't find it" → alternate location;
   "Out of stock" → skip and reroute.
5. **Why this order** (optional, from `/explain`).
6. **Add a store** (hero feature) — capture photos → AI draft overlaid on the photo → review/fix → save.

---

## 8. Day-by-day

**Day 1 — core works on the phone, no AI**
- [ ] Monorepo + Expo app running in Expo Go on the owner's phone
- [ ] `store.json` for H-E-B: nodes/edges from §4, all 167 directory items with locations + tags
- [ ] `validate-store.ts`: every product reachable from both entrances, no unknown aisles
- [ ] Routing engine + tests A/B passing
- [ ] Route screen draws the route correctly over the map
- [ ] Evening (~1–2 h): eval runner + **T1 and T2 on both providers** (§10) — answers §6 "Biggest unknown"
- **Done when:** owner types Test A on their phone and sees the correct drawn route.

**Day 2 — matching, shop mode, AI, APK**
- [ ] Fuzzy matching + Clarify screen + Shop mode
- [ ] Run **T3/T4** (§10); set primary/backup provider per job from the results
- [ ] Server `/resolve` with the winning provider primary, the other as fallback; alias learning
- [ ] Server `/read-list` + "Snap or upload a list" button (camera on phone, file picker on desktop);
      recipe ingredient checkboxes (~2–3 h)
- [ ] `eas build` APK installed on the phone via QR — start the build **early in the day**; the free
      EAS build queue can take a while
- **Done when:** "headache stuff, cerial, ice cream" produces a sensible route in the installed APK,
  **and** a photo of a handwritten list and a recipe page each produce a route.

**Day 3 (Nov 1) — Meta AI hero feature (25% of score)**
- [ ] `/ingest`: directory photo → item list; map photo → SAM 3.1 segments → labeled store graph
- [ ] "Add a store" + review/fix screen in the app
- [ ] Test it on the H-E-B images: the draft should come close to the hand-built `store.json`
- Day 3 T2 plan (from the Oct 31 eval: Meta T2 agree 0%, xErr 43–72px): write the `t2-v2`
  prompt, run Meta 2–3× and merge by majority, review screen required before saving any
  AI-built store. Whether temperature is supported: needs verification.
- **Done when:** a store built from photos produces a working route.

**Day 4 (Nov 2–3) — live product, polish, repo**
- [ ] Deploy server to Cloudflare Workers (`wrangler deploy`; keys via `wrangler secret put`); point the app at its URL
- [ ] **Live link for judges:** `npx expo export -p web` → Cloudflare Pages (`<name>.pages.dev`; judges won't sideload an APK) + APK in GitHub Releases
- [ ] Workers notes: allow CORS for the Pages domain and the app; accept image uploads as multipart; per-device rate limit so the public link can't burn API credits
- [ ] Savings metric on the route screen; animated route drawing; edge cases from §4; `/explain`
- [ ] README: problem, who it helps, architecture diagram, which Meta models do what, how to run,
      live link, APK link, video link. Repo public, no secrets, `.env.example`.
- [ ] Rehearse the demo end-to-end with provider fallback forced on once

**Day 5 (Nov 4) — video + submit (target: submitted by noon ET; hard deadline 9:00 PM ET)**
- [ ] Record the 3-minute video (script below), upload, check the link works logged-out
- [ ] Check repo is public, live link works, everyone is listed on the submission page
- [ ] Submit

### 3-minute video script
| Time | Scene | Rubric it hits |
|---|---|---|
| 0:00–0:20 | The problem: wandering a store with a list; who it hurts (busy parents, elderly shoppers, pickers) | Impact |
| 0:20–1:10 | Phone: snap a **handwritten list** (or a recipe page) → Meta vision reads it → messy items resolved ("cerial", "headache stuff") → clarify one item → route animates on the map → "38% shorter, ~6 min saved" | Demo, Impact, Use of Meta AI |
| 1:10–2:00 | Hero: photograph a different store's map + directory → SAM 3.1 segments aisles, Meta vision reads labels → review screen → route works in a store the app had never seen | Use of Meta AI |
| 2:00–2:40 | Under the hood: architecture diagram; AI interprets, exact solver routes; schema validation; Meta API ⇢ Baseten fallback; tests passing | Technical depth |
| 2:40–3:00 | Impact wrap: works in any store from two photos; who could use it next (store apps, curbside pickers) | Impact |

---

## 9. Owner checklist (everything only the owner can do)

Already on the Mac (checked Oct 30): Node v26, npm, git, GitHub CLI `gh`. Not yet: `eas`, `wrangler`.
If Expo tools complain about Node 26, install the current Node LTS.

### A. Before the build starts (today, ~30 min)
**Accounts**
- [ ] **GitHub** — create a **public** repo (e.g. `QuickAisle`); run `gh auth status` to confirm the CLI is logged in
- [ ] **Expo** — free account at expo.dev
- [ ] **Cloudflare** — free account at dash.cloudflare.com (no card needed)
- [ ] **Baseten** — have it ✅. In the dashboard → Model APIs, note the **model name** and whether it **accepts images**
- [ ] **Meta Model API** — confirm hackathon access, create an API key, get the **docs link**

**Phone (Android)**
- [ ] Install **Expo Go** from the Play Store
- [ ] Phone and Mac on the **same Wi-Fi** (needed for Days 1–2)

**Test the keys yourself (never paste keys into a chat)**
- [ ] Baseten: run the 2-minute `curl` test from the model's page in the dashboard → you get a reply
- [ ] Meta: run the quick-start example from their docs → you get a reply

**Decisions**
- [ ] Track: **Indie** (solo/student) or Startup — plan assumes Indie
- [ ] Teammates' names (all must be on the submission page)
- [ ] Store images in a public repo: use your **own photos** of a store, or the H-E-B images credited as
      "demo store" (not affiliated) — your call

**Give the new chat**
- [ ] Open the new chat **in the QuickAisle folder** — the plan, images and `eval/` are already there
- [ ] Project folder path, GitHub repo URL
- [ ] Baseten model name + "accepts images: yes/no"; Meta docs link + model names you have access to
- [ ] **Not** the keys themselves

### B. When the new chat asks (Days 1–2)
- [ ] Put keys in `server/.dev.vars` (the chat creates the file with blank lines for you to fill):
      `BASETEN_API_KEY=…`, `BASETEN_MODEL=…`, `MODEL_API_KEY=…`
- [ ] `npm i -g eas-cli` then `eas login` (Day 2, before the APK build)
- [ ] `npx wrangler login` (opens the browser once)
- [ ] Scan the Expo Go QR code on your phone; later scan the APK QR → allow **Install unknown apps** → Install

### C. Material to collect (by Day 2–3)
- [ ] **10 list photos** for test T4, each with its items written down: 5 handwritten lists,
      2 screenshots (text/notes), 2 recipes, 1 product or empty package
- [ ] **A second store's** map + directory photos (for the "never-seen store" video moment)
- [ ] Optional: walk one real aisle and note its length → turns pixels into meters for "min saved"

### D. Going live (Day 4)
- [ ] `npx wrangler secret put BASETEN_API_KEY` (and `BASETEN_MODEL`, `MODEL_API_KEY`) — paste when asked
- [ ] Approve the Cloudflare Pages project (the chat runs the deploy; you may need to click "allow" once)
- [ ] Upload the `.apk` to the repo's **GitHub Releases** (or let the chat do it with `gh release create`)
- [ ] Open the live link on your phone **and** on a friend's iPhone if possible

### E. Submission (Day 5 — Nov 4, target noon ET, hard deadline 9:00 PM ET)
- [ ] Record the **3-minute video** (script in §8) — screen-record the phone + voice-over
- [ ] Upload to **YouTube (Unlisted)** or Loom; open the link in a **logged-out/incognito** window to confirm it plays
- [ ] Confirm repo is **public**, no keys in it (`git log -p | grep -i key` finds nothing sensitive)
- [ ] Submit on the Cerebral Valley page as the **Representative**: repo URL, video URL, live link,
      everyone listed

---

## 10. Provider accuracy test + backup plan (Meta Model API vs Baseten)

Goal: **measure** which provider is better at each AI job instead of guessing, pick the primary per job,
and know exactly when to switch. Ground-truth files are already written — see `eval/`.

### What's already in `eval/` (hand-made ground truth)
| File | What it is | Size |
|---|---|---|
| `eval/gold/directory.json` | Every directory line **exactly as printed** (name + aisle), plus the known map-vs-directory conflicts | 167 items |
| `eval/cases/resolve.json` | Messy list inputs → expected product. Covers spelling, synonyms, brands, vague requests, departments, items that need a question (cheese/chicken/bread), Spanish, "taco night" expansion, and junk that must **not** match | 58 cases |
| *(to create)* `eval/cases/list-photos/` | 10 photos + `expected.json` of the items in each: 5 handwritten lists, 2 screenshots, 2 recipes, 1 product | owner supplies photos |
| *(reuse)* hand-built `store.json` | Ground truth for map reading: 17 aisles, x-positions in §4, 2 entrances, departments by wall | from Day 1 |

### The four tests
| Test | Input | Score (higher is better unless noted) |
|---|---|---|
| **T1 Directory reading** | `directory.png` → model returns `[{name, aisle}]` | **Item recall** (found / 167), **aisle accuracy** (exact match, normalized: "13A"="13a", "End Cap"="endcap"), extra/hallucinated items (lower better) |
| **T2 Map reading** | `map.png` → aisle numbers + positions, departments, entrances | Aisle count correct (17), aisle **order** correct, mean position error vs §4 (px, lower better), departments found, entrances found (2). **End-to-end:** build store from AI output → run routing tests A and B → same route? |
| **T3 List understanding** | each case in `resolve.json` | **Top-1 accuracy**, **asks when it should** (clarify cases) and **doesn't ask when it shouldn't**, **invented products = 0** (after server validation; also report raw rate before validation) |
| **T4 List photos** | photos in `list-photos/` | Item recall + precision after matching, recipe staples correctly skipped |

**For every test, also record:** valid-JSON rate (first try, and after one retry), latency p50/p95,
cost per run (tokens × price), and **consistency** — run each case **3 times**; report how often the
3 answers agree.

### Runner
```
npm run eval -- --task t1|t2|t3|t4|all --provider meta|baseten|both --runs 3
```
- Lives in `eval/run.ts`; calls the **same** `llm.*` provider layer the server uses (so we test the
  real code path, prompts included).
- Writes `eval/results/<date>-<task>.json` (raw answers) and `eval/results/<date>-summary.md`:

| Test | Metric | Meta Model API | Baseten (Llama) |
|---|---|---|---|
| T1 | row acc. | 100% ×3, agree 100%, max 12.1s | 100/99.4/100% (Condiments 7 vs 3; tok to 3977/4000), max 13.5s |
| T2 | composite | 75/98/100%, agree 0%, xErr 43–72px, max 14.2s | ~70% every run (4–5/14 depts, xErr 120–175px, retry every run: empty attempt 0) |
| T3 | top-1 / clarify / invented | – | – |
| T4 | recall / precision | – | – |
| all | JSON valid · max latency · $/run · consistency | valid post-retry · see above · $ n/a · T1 100%, T2 0% | valid post-retry · see above · $ n/a · T1 high, T2 n/a |

Measured Oct 31, runs=1 then runs=3 (raw in `eval/results/`, gitignored). Primary per
decision rules: Meta for T1 (within 3pp → faster wins) and T2 (higher score); Baseten
is backup. Commit the summary — it's good README and video material ("we measured both providers").

### Decision rules (per job)
1. **Primary** = higher main score (T1 aisle accuracy, T2 route match, T3 top-1, T4 recall).
2. If the two are within **3 percentage points**, pick the **faster** one (p95 latency).
3. Must-pass bars before a provider can be primary: valid JSON ≥ 95% after one retry; invented
   products = 0 after validation; T3 top-1 ≥ 85%; T1 aisle accuracy ≥ 90%.
4. If **neither** passes a bar for a job, that job gets a safer fallback (below) instead of shipping on a coin flip.
5. Re-run `--task all` after **any prompt change** and before recording the video.

### Backup plan — when to switch, and what's next in line
| Job | Primary | 1st backup | 2nd backup (no AI) |
|---|---|---|---|
| List text (T3) | winner of T3 | the other provider | local fuzzy match + "did you mean" picker |
| List photo (T4) | winner of T4 | the other provider | ask the user to type the list |
| Directory photo (T1) | winner of T1 | the other provider | user types/edits rows on the review screen |
| Map photo (T2) | winner of T2 (SAM 3.1 path) | vision-only layout → grid the user adjusts (§6) | pick a preloaded store |
| Live demo | live calls | `DEMO_MODE` replay of saved responses | pre-recorded video segment |

**Switch to the backup automatically when:** request times out (15 s text / 45 s vision), HTTP 429 or
5xx, or the answer fails schema validation after **one** retry. Log which provider answered each
request; show a small "answered by: Meta / Baseten" tag in a debug view (useful in the video).

### When to run it
- **Day 1 evening** (replaces the plain spike): T1 + T2 on both providers → tells us early whether
  the photo-to-store feature is realistic and which provider leads it.
- **Day 2:** T3 + T4 → pick primary for `/resolve` and `/read-list`.
- **Day 3:** T2 again with the full `/ingest` pipeline, plus on the second store's photos.
- **Day 4:** `--task all` final run; numbers go in the README.
