# QuickAisle

Snap a store map (or use a saved store), type / photograph / say your
shopping list, and get the shortest walking route through the store.

Who it helps: shoppers in big unfamiliar stores, people with limited
mobility or time, and store staff picking orders.

## Try it

- Web: https://quickaisle.pages.dev — the sample stores work fully
  offline in the browser (bundled store, on-device matching and routing).
- Android APK: GitHub Releases (link added at release).
- Demo video: https://youtu.be/wQ-Z9OLb3tE

The demo is rate-limited: 40 AI units per hour per visitor, 400 units
per day total across everyone. A map read costs 3–6 units, a list photo
2, resolving terms or transcription 1 each. When the limit is hit the
server answers 429 ("Demo limit reached — try again later or use the
sample store") and the app shows that message; the sample store and
offline matching keep working.

## Core idea

AI drafts, a human reviews, an exact solver routes.

The AI never decides the route. Once items are matched to stops, an
exact Held–Karp solver (up to 15 stops, greedy heuristic above that)
finds the shortest path over the store's walkway graph — computed on
the phone, not by the model.

## How it works

```
map photo ──> /ingest ──> AI draft ──> YOU review ──> walkway graph
typed / photo / spoken list ──> matching ──┐
                                            ├─> exact solver ──> route
store walkway graph ────────────────────────┘
```

Server (Hono Worker, keys only server-side):

- `/read-list` — list/recipe photo → items. Meta `muse-spark-1.3`
  primary, Baseten hedge if it hasn't answered in 8 s.
- `/resolve` — messy terms → catalog matches. Baseten primary
  (`meta-models/muse-spark-open-1026`, Meta open weights — it won the
  T3 eval), Meta hedge after 12 s.
- `/ingest` — store map → layout draft. Meta only, no fallback:
  3 parallel reads + majority merge. Two-view: the map is also read
  rotated 90° so sideways aisle labels read upright; each aisle takes
  items from the view where its labels are upright, geometry always
  from the original. 6 Meta calls, ~30–35 s per map.
- `/voice-list` — spoken list → transcript → text box → normal
  matching. Meta speech-to-text (`muse-voice-transcribe-1.0`);
  16/24 kHz mono 16-bit WAV only, 30 s cap.

On the phone, offline: matching (fuzzy + learned aliases +
staple→department fallback, e.g. eggs → Dairy), routing, map drawing.
API keys live only in the Worker — never in the app, repo, or
`EXPO_PUBLIC_*`.

## Add a store

Photo of the store map → AI draft → review screen → saved on device.
The review screen is required: you fix aisle numbers, orientations,
and items before anything is saved. Then code (not the model) builds
the walkway graph from the draft (`build-from-draft`) and the store is
saved on the device.

Tip: for wide maps, hold your phone sideways so the whole map fills
the photo.

## Results

T1–T4 numbers come from the eval runner (`eval/`, summaries in `eval/results/*-summary.md`). The /ingest item scores were hand-scored against a hand-read answer key for that map (not in the repo).

- T1 directory reading (Oct 31, runs=3): Meta 100% on all three runs;
  Baseten 100 / 99.4 / 100%.
- Route acceptance: Test A route 28.1% shorter than typed order;
  Test B 22.4% shorter.
- T3 item resolving: Baseten 93.7%, Meta 90.8% — why Baseten is
  primary for `/resolve`.
- T4 photo lists, both runs: run 1 — Meta 98.6%, Baseten 92.8%;
  run 2 — Meta 100%, Baseten 97.1%. Zero trap items in 40 calls.
- `/ingest` on a second H-E-B map (39 aisles, mixed orientation,
  Nov 3): 39/39 aisles, 0 fake aisles (curbside 1–10 and counter
  letters correctly ignored), 2/2 entrances. Items landing in the
  correct aisle, original-only → two-view: aisles 1–15, 62% → 99%;
  aisles 19–31, 99% → 100%; aisles 32–39, 90% → 100%;
  overall 79% → 99% (164/165). Labels found: 92%.
- A third store, photographed on a phone, worked end to end:
  photo → review → route.
- Voice: the live STT probe returned a transcript in ~1.3 s.
- Tests: 203 automated tests — run them with `npm test`.

## Limitations

- Draft layout lines are approximations: they can cut corners or run
  through departments, and a horizontal aisle near a wall can get a
  walkway that doesn't exist on the real floor. That's why the review
  screen is required.
- Short terms can silently match a longer word — in a store with no "Ice" item, "ice" is auto-matched to Rice. Edit the list (e.g. "bag of ice") if a stop looks wrong. Low-similarity "Did you mean" cards are suppressed (similarity ≥ 0.75 and a shared word stem required).
- Tiny sub-labels on maps are often missed by the vision reads.
- The public demo is rate-limited (see above).
- No live store inventory — the app routes over a static snapshot of
  the store, not live stock.
- SAM was explored for map segmentation but not used: Meta vision
  reads the structure and code builds the walkway graph.

## Repo layout

```
apps/mobile        Expo app: App, AddStore review screen, VoiceButton, wav
packages/schema    Zod store document (products, locations, graph)
packages/routing   exact Held–Karp + greedy routing, build-from-draft
packages/matching  fuzzy matching, learned aliases, department fallback
server             Hono Worker: resolve, read-list, ingest + ingest-merge,
                   voice, ratelimit, providers (meta, baseten, hedge)
eval               tasks T1–T4, goldens, results
data/stores        heb-001 (bundled sample), store-002 (second H-E-B map)
scripts            build-store, validate-store, ingest-try, probe-voice,
                   probe-temperature
```

## Run it locally

```sh
npm install
cp server/.dev.vars.example server/.dev.vars   # then add your own keys
npm run dev --workspace=@quickaisle/server
EXPO_PUBLIC_API_URL=<worker url> npm start --workspace=mobile
npm test
```

Useful scripts (keys never leave your machine except to the providers):

```sh
node scripts/ingest-try.ts <map> [--rotated <rotated map>]
node scripts/probe-voice.ts <file.wav>
```

Keys never go in the app, the repo, or `EXPO_PUBLIC_*` — only in
`server/.dev.vars` (gitignored) or the Worker's secrets.

## Credits

H-E-B store maps are used as demo stores only; not affiliated with or
endorsed by H-E-B. Built for the Meta Global AI Developer Hackathon
(Cerebral Valley), 2026. MIT license.
