---
name: verify
description: Build, launch, and drive the Peek app to verify a change end-to-end (Vite + live Convex dev deployment + headless Chromium via playwright-core, with a CDP virtual authenticator for passkey sign-in).
---

# Verifying Peek changes at the running app

## Launch

- `npm run dev` (background) → http://localhost:5173. `.env.local` already
  points at the live Convex dev deployment (`hallowed-stork-966`), so the
  app runs in **Convex mode** with the seeded demo dataset.
- **It must be port 5173.** `redirect_uri` is compared exact-string against
  the app's registered list, so on 5174 the round trip dies at Estiva ID with
  `That redirect_uri is not registered for this app`. A stray earlier `vite`
  holding 5173 is enough to cause it, and it reads like an auth bug rather
  than a port collision. Check with `ss -ltnp | grep 517` and kill the old one.
- Tool shells are not interactive, so `node` may be missing from `PATH`.
  Source nvm first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- Unit tests / Storybook run in **mock mode** (no `VITE_CONVEX_URL` in
  test env) — they never exercise the Convex read/write paths. Anything
  touching `hasConvex === true` branches must be verified in the running app.

## Drive (headless browser)

- `playwright-core` is a devDependency. Use **Playwright's own Chromium**:
  `chromium.launch({ headless: true })` — no `executablePath`.
  Install it once with
  `node node_modules/playwright-core/cli.js install chromium` (~114 MB into
  `~/.cache/ms-playwright`, no sudo).
- Do **not** reach for a Windows browser from WSL. The system Chrome this
  skill used to name is gone, and Edge cannot be driven across the boundary:
  Playwright launches it with `--remote-debugging-pipe` and the file
  descriptors do not cross (`Remote debugging pipe file descriptors are not
  open`); the `--remote-debugging-port` fallback binds to Windows' own
  loopback, which WSL cannot reach.
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
auto-login**. The only sign-in is the Estiva ID redirect, which needs a
passkey — so signing in headlessly needs a CDP virtual authenticator.

**Use `scripts/signedIn.mjs`** rather than rewriting it each time:

```js
import { signedInPage } from './.claude/skills/verify/scripts/signedIn.mjs'
const { browser, page, pubkey } = await signedInPage()
await page.goto('http://localhost:5173/topics')
// … drive it …
await browser.close()
```

It installs the authenticator with `automaticPresenceSimulation` (answers the
"touch your key" prompt — without it the ceremony hangs forever in headless),
`isUserVerified`, and `hasResidentKey` so the credential is discoverable, which
is what lets Estiva ID offer a usernameless sign-in. It then clicks
**"Continue with passkey"** — the click is required, because WebAuthn needs a
user activation and no design can invoke the ceremony automatically on load —
and resolves once a token lands in `sessionStorage`.

### Point it at a local Estiva ID, not production

A virtual authenticator is safe in itself: additive, scoped to one browser
instance, unable to read or exfiltrate real credentials, and the platform
authenticator is untouched. It also grants nothing that CDP access did not
already grant.

**The risk is which identity service you aim it at.** Registering against a
real deployment creates a *real* credential server-side whose private key
lives only in a throwaway browser profile — an orphan that can never be used
again and is indistinguishable from a genuine device in the account's key
list. So `signedIn.mjs` refuses to run against `https://id.estiva.app` unless
`PEEK_VERIFY_ALLOW_PROD=1` is set deliberately.

Run a local one instead (`../estiva-id`, `docker compose up` for its Postgres),
with `http://localhost:5173/auth/callback` in `PEEK_REDIRECT_URIS`, and set
`VITE_ESTIVA_ID_ORIGIN` for **both** the dev server and the script.

Other consequences for driving the app:

- Unauthenticated → the shell settles on a single **"Continue with passkey"**
  button after one silent `prompt=none` probe.
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
