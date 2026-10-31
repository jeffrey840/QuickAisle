# Provider fixtures (DEMO_MODE replays)

`DEMO_MODE=1` makes the provider layer replay these files with **zero network
calls**, for judging demos that must not depend on any API being up.

Record them from live responses (needs keys in `server/.dev.vars`):

```bash
npm run eval:record
```

That writes one `<key>.json` per call (`t1-meta`, `t1-baseten`, `t2-meta`,
`t2-baseten`). Each file holds the raw model content plus metadata — never any
key. Replays go through the same strip → parse → Zod-validate path as live
responses, so a stale fixture fails loudly instead of silently passing.
