# Peek ↔ Buzz / Nostr for Business

Analysis for making Peek's backend speak Nostr, as close to
[Buzz](https://github.com/block/buzz)'s event model as possible.

> **This is a historical record, not a working directory.** It is the research
> that decided the design, and its conclusions are live — but the *code* it
> once contained is not. The three probe scripts were deleted in PRO-7 and this
> says what replaced them; see [The code](#the-code).
>
> The prose is deliberately left as written, including paths like
> `/home/miky/peek-app` and commit ids. It records what was analysed and when,
> and rewriting that to look current would make it a worse record, not a better
> one.

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
| **Update the RFC** | **[RFC_UPDATES.md](RFC_UPDATES.md)** — what to change in 0.2, by section |
| **Build the next app** | **[LINEAR_LITE_SPEC.md](LINEAR_LITE_SPEC.md)** |
| **Understand identity across the suite** | **[ESTIVA-ID.md](ESTIVA-ID.md)** — one human, one pubkey |
| Understand the Folder/File/Component design | [FILES_ARCHITECTURE.md](FILES_ARCHITECTURE.md) |
| Read the first NIP draft (superseded) | [nips/NIP-FC.md](nips/NIP-FC.md) |

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
| `emit-buzz-event.mjs` | Standalone emitter from the first analysis pass. Superseded by the modules, kept because it documents every Peek field with nowhere to go |
| `verify-with-buzz/` | Rust harness that runs **Buzz's own crates** over Peek's output — the cross-implementation check. Its `Cargo.toml` path-depends on a local `~/buzz` checkout, so it runs where one exists and nowhere else |

### The three scripts that were here, and what replaced them

Deleted in PRO-7 (2026-08-31). All three had stopped working, in two different
ways, and none of it was visible because nothing typechecks `docs/`.

| Deleted | Why it was broken | What does the job now |
| --- | --- | --- |
| `publish-to-relay.ts` | imported `convex/nostr/events`, `sign` and `nip98` — moved into `@estiva-app/protocol` by SHA-3 | `@estiva-app/protocol`'s own tests |
| `verify-foreign-render.ts` | imported `/home/miky/linear-lite/…`, a repo since renamed to `ship` and never a sibling of this one | `interop/projection.test.ts` — 61 tests, no relay needed |
| `verify-foreign-action.ts` | same | as above, plus `estiva-ship`'s `scripts/pro7-probe.ts` against the live relay |

**Their results are not lost, which is why deleting them is safe.**
[INTEROP_PROOF.md](INTEROP_PROOF.md) and [`live-relay-run.txt`](live-relay-run.txt)
are verbatim output from real runs, and the claim they established — that one
app can render another's objects from a published manifest with no shared code
— is now made continuously by the projection layer rather than by a script
somebody remembers to run.

**The lesson worth keeping.** A script importing an absolute path outside its
own repository is not a check; it is a note about one machine's filesystem. All
three read as working code for months because a broken import in `docs/` fails
nowhere. PRO-7 reintroduced exactly this defect in `estiva-ship` on the same day
it was found here, and CI caught that one in minutes — the difference being that
the file was somewhere the compiler looks.

## The demo apps

They live in a **separate repo**: `~/nfb-demos`. Look-alike stand-ins for Meet,
Figma and Linear, showing what those tools would be like on Nostr.

They deliberately share no code with Peek — each has its own copy of the
protocol helpers, so "two independent apps interoperating" means what it says.
See that repo's README to run them.

## Running things

**Start the relay** (needs Docker Desktop running, with WSL integration if on
Windows):

```bash
cd ~/buzz && ./bin/just relay
```

Brings up Postgres and Redis, runs migrations, seeds the loopback community
rows, and starts the relay on `:3000`. First run compiles ~1,000 crates.

**Publish from Peek to it:** the script that did this was deleted — see
[The code](#the-code). The wire format now lives in `@estiva-app/protocol` and
is exercised by that package's tests rather than by a probe here.

**Check Peek's builders still match Buzz's Rust:** `convex/nostr/events.test.ts`
is gone for the same reason (SHA-3 moved the builders out). The
cross-implementation check that survives is `verify-with-buzz/`, which runs
Buzz's own crates.

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
