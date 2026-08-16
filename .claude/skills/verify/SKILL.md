---
name: verify
description: Build, launch, and drive the Peek app to verify a change end-to-end (Vite + live Convex dev deployment + headless system Chrome via playwright-core).
---

# Verifying Peek changes at the running app

## Launch

- `npm run dev` (background) → http://localhost:5173. `.env.local` already
  points at the live Convex dev deployment (`hallowed-stork-966`), so the
  app runs in **Convex mode** with the seeded demo dataset.
- Unit tests / Storybook run in **mock mode** (no `VITE_CONVEX_URL` in
  test env) — they never exercise the Convex read/write paths. Anything
  touching `hasConvex === true` branches must be verified in the running app.

## Drive (headless browser)

- `playwright-core` is a devDependency (no browser download); launch with
  the system Chrome:
  `chromium.launch({ executablePath: 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', headless: true })`
- Put the driver script **inside the repo** (e.g. `.verify-drive.mjs`,
  delete after) — Node resolves `playwright-core` from the script's dir,
  not cwd.
- URL routing: `/desk`, `/topics`, `/topics/:id`, `/people`, `/people/:id`.
- Clicking a message card opens the thread panel (the card body is the
  click target). Seeded bodies in `src/data/topicData.ts` make good
  `getByText` anchors (e.g. t1_c1 "Hey everyone, our CI/CD pipeline…").

## Server-side state divergence trick

To prove remote-vs-mock precedence, mutate the deployment directly so the
mock and the server disagree, then check which one renders:

```
npx convex run messages:editBody '{"key":"t1_c1","body":"MARKER …"}'
```

Always revert afterwards (original bodies are in `src/data/*`), or reseed:
`npx convex run dev/seedDemo:seed '{"wipe": true}'` (dev-only; also resets
any test topics/messages created while driving).

## Auth (Estiva ID only, since PEEK-41)

Convex Auth is gone. There is **no password screen, no OTP, and no dev
auto-login** — everything below used to describe them and no longer applies.
The only sign-in is the Estiva ID redirect, which needs a passkey, so a
headless driver cannot complete it without CDP's virtual authenticator
(`WebAuthn.addVirtualAuthenticator`, the approach Estiva ID's own tests use).

Consequences for driving the app:

- Unauthenticated → a single card offering **"Sign in with Estiva ID"**.
- Anything behind `usesEstivaId` — publishing, relay reads, foreign-object
  widgets — is inert without a token, and fails by rendering **nothing**
  rather than erroring. A quiet screen is the expected shape when unsigned,
  not a bug to chase.
- **Reseed:** `npx convex run dev/seedDemo:seedAs '{"pubkey": "<64 hex>", "wipe": true}'`
  seeds the demo dataset and stamps *your* pubkey on the seed user Cath, so
  signing in with Estiva ID lands you on her with the data behind you rather
  than as a new person in an empty workspace. Take the pubkey from the stored
  token (`sessionStorage`) or from your row in the `users` table.
  Plain `seed` still works and leaves Cath unclaimed.

## Gotchas

- The seeded dataset may have accumulated extra records from earlier
  manual testing (e.g. stray topics) — reseed if a clean baseline matters.
- Screenshots: 1600×950 viewport matches the design reference well.
