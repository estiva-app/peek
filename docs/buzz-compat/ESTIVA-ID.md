# Estiva ID — identity for the suite

**The design lives in the `estiva-id` repo, not here.** This page exists so
someone reading `docs/buzz-compat/` finds it.

| Document | What |
| --- | --- |
| `estiva-id/docs/ARCHITECTURE.md` | The key / admission / attestation split, the `/sign` seam and why not NIP-46, why custody is accepted in Stage 1, what Stage 4 buys and costs |
| `estiva-id/docs/KEY-CUSTODY.md` | The at-rest encryption format, designed for M-of-N escrow before escrow exists |
| `estiva-id/docs/OPEN-SEAMS.md` | The two decisions deliberately left open — domain layout for `nip05`, and who drives community admission |
| `estiva-id/docs/API.md` | Endpoints, token claims, signing policy |

The spec is kept in that repo rather than copied here on purpose. Estiva ID is a
standalone app on its own origin with its own database, and a second copy of its
design in `peek-app` would drift.

## The short version

One human is currently two pubkeys: Peek mints a custodied key per account,
Linear-lite generates a throwaway key per browser. Estiva ID becomes the single
custodian, so the same person is the same pubkey in both apps.

Three concerns stay separate:

* **Key** — Estiva ID, custodial for now.
* **Admission** — the Buzz relay's `admittedMembers`, already formally verified
  (`Inv_AdmissionFence`). This is the offboarding lever.
* **Attestation** — the `nip05` handle, org-revocable.

A leaver keeps their keypair; they lose the handle and the door.

## What this means for Peek

* **Peek becomes read-only on identity.** Estiva ID is the sole publisher of
  `kind:0` — `/sign` refuses kind:0 for every app.
* **Peek stops signing locally.** `convex/nostr/keys.ts` is superseded by
  custody in Estiva ID; backend signing becomes a `POST /sign` call (PEEK-40).
* **Convex Auth is deleted** and `convex/auth.config.ts` is repointed at the
  identity issuer, with `getUserIdentity().subject` becoming the pubkey
  (PEEK-38).
* **The key migration runs and is verified before anything is removed.** A failed
  migration with the auth tables already gone is the one unrecoverable outcome
  in this project.

Two notes for whoever does the Peek side:

* `convex/nostr/events.ts` and Estiva ID's `src/nostr/event.ts` are independent
  implementations, kept in agreement by both pinning to event ids Buzz's Rust
  produced. That duplication is deliberate — do not factor them into a shared
  package.
* Peek's relay publishes report failures only via `console.warn`. Once no app can
  sign locally, an identity-service outage looks like nothing happening. Make it
  loud before Stage 2.
