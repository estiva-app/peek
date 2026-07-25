# Peek ↔ Buzz / Nostr for Business

Analysis and working code for making Peek's backend speak Nostr, as close to
[Buzz](https://github.com/block/buzz)'s event model as possible.

**Status:** Peek publishes to a live Buzz relay and reads back. Verified end to
end — see [INTEROP_PROOF.md](INTEROP_PROOF.md) §0.

## Start here

| If you want to… | Read |
| --- | --- |
| **Run it on your machine** | **[RUNNING.md](RUNNING.md)** |
| Know whether this actually works | [INTEROP_PROOF.md](INTEROP_PROOF.md) §0 |
| Know what to build next | [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) |
| Understand how Buzz's protocol works | [BUZZ_PROTOCOL_MODEL.md](BUZZ_PROTOCOL_MODEL.md) |
| Understand what Peek stores today | [PEEK_DATA_MODEL.md](PEEK_DATA_MODEL.md) |
| See where Buzz and the NfB RFC conflict | [COMPATIBILITY_GAP_ANALYSIS.md](COMPATIBILITY_GAP_ANALYSIS.md) §3 |
| **Know which NIPs to reuse vs. write** | **[NIP_SURVEY.md](NIP_SURVEY.md)** |
| **Know which demo scenarios are buildable now** | **[SCENARIO_FEASIBILITY.md](SCENARIO_FEASIBILITY.md)** |

## The documents

- **[PEEK_DATA_MODEL.md](PEEK_DATA_MODEL.md)** — every Peek table, the identity
  and sync model, and which entities are durable business actions vs. app-local
  state. That split is the rule the rest of the work rests on.
- **[BUZZ_PROTOCOL_MODEL.md](BUZZ_PROTOCOL_MODEL.md)** — Buzz's event kinds,
  which NIPs it reuses vs. invents, the NIP-OA agent↔owner mechanism, the relay
  architecture, and the permission model. Cited to code throughout.
- **[COMPATIBILITY_GAP_ANALYSIS.md](COMPATIBILITY_GAP_ANALYSIS.md)** — entity
  mapping table, where the two models collide, and §3's scorecard grading Buzz
  against every commitment in NfB RFC 0.2.
- **[INTEROP_PROOF.md](INTEROP_PROOF.md)** — real output, not predictions.
- **[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** — staged plan with effort
  tiers and explicit unknowns.

## The code

| File | What it does |
| --- | --- |
| `publish-to-relay.ts` | End-to-end probe. Imports Peek's real `convex/nostr/*` modules and publishes a profile, channel and message to a running relay, then reads them back |
| `emit-buzz-event.mjs` | Standalone emitter from the first analysis pass. Superseded by the modules, kept because it documents every Peek field with nowhere to go |
| `verify-with-buzz/` | Rust harness that runs **Buzz's own crates** over Peek's output — the cross-implementation check |
| `demo/` | **The interop demo.** A task board — a different kind of app — on the same channel Peek writes to. See below |

## The demo

`demo/` is a small standalone page that reads and writes the same Nostr channel
Peek publishes to. Peek renders those events as chat messages; this renders them
as tasks. **There is no integration between the two** — no shared database, no
API call, no webhook. They agree on a relay URL and a channel UUID.

```bash
# 1. relay running (see above), then serve the page:
cd docs/buzz-compat/demo && python3 -m http.server 5180
# 2. open http://localhost:5180 and paste in a channel UUID
#    (find one: npx convex data topics  → the channelUuid column)
```

The page holds **its own keypair**, generated in the browser and stored in
`localStorage` — it is a different identity from any Peek user, shown as a
different colour.

`two-app-run.txt` is a captured headless run proving the claim without a
browser: a fresh identity reads Peek's events, publishes its own, and both
coexist in one stream.

> **Honest limit:** interop is currently **one-way at Peek's end**. Peek writes
> to the relay and anything can read it, but Peek does not yet read *back*, so a
> task created in the demo will not appear in Peek's UI until Stage 2's read path
> exists. The demo page shows both directions because it talks to the relay
> directly.

`bundle.js` is generated and committed so the demo runs with no build step.
Rebuild after editing `app.ts`:

```bash
npx esbuild docs/buzz-compat/demo/app.ts --bundle --format=esm --outfile=docs/buzz-compat/demo/bundle.js
```

## Running things

**Start the relay** (needs Docker Desktop running, with WSL integration if on
Windows):

```bash
cd ~/buzz && ./bin/just relay
```

Brings up Postgres and Redis, runs migrations, seeds the loopback community
rows, and starts the relay on `:3000`. First run compiles ~1,000 crates.

**Publish from Peek to it:**

```bash
npx vite-node docs/buzz-compat/publish-to-relay.ts
```

**Check Peek's builders still match Buzz's Rust:**

```bash
npx vitest run convex/nostr/events.test.ts
```

That test pins Peek's output to event ids Buzz's own crates produced. A failure
means the two implementations have drifted — don't update the expected ids.

## Three findings worth not rediscovering

1. **The relay's ingest allowlists kinds.** `required_scope_for_kind` returns
   `Err` for unknown kinds and rejects them, so NfB cannot add File/Component
   kinds to a stock Buzz relay without patching Rust.
2. **Buzz has no cross-org replication.** `federat*` appears once repo-wide, in a
   Helm README, unimplemented. This conflicts directly with RFC §1.3.
3. **The HTTP bridge uses NIP-98, not NIP-42** — no challenge/response, which is
   what makes it usable from Convex's request-scoped runtime. `POST /query` takes
   a bare JSON *array* of filters.
