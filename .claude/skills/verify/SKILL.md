---
name: verify
description: Use to prove a Peek change works, either end to end in the running app (Vite + the relay + headless Chromium via playwright-core, with a CDP virtual authenticator for passkey sign-in) or by rendering and measuring a story in Storybook.
---

# Verifying Peek changes at the running app

## Launch

- `npm run dev` (background) → http://localhost:5173. With `VITE_RELAY_URL`
  in `.env.local` the app reads and writes the relay it names — production's
  is the team's real data.
- **Never publish test data to the production relay** that you do not
  delete again.
- **It must be port 5173.** `redirect_uri` is compared exact-string against
  the app's registered list, so on 5174 the round trip dies at Estiva ID with
  `That redirect_uri is not registered for this app`. A stray earlier `vite`
  holding 5173 is enough to cause it, and it reads like an auth bug rather
  than a port collision. Check with `ss -ltnp | grep 517` and kill the old one.
- Tool shells are not interactive, so `node` may be missing from `PATH`.
  Source nvm first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.
- Unit tests / Storybook run in **mock mode** (no `VITE_RELAY_URL` in
  test env) — they never exercise the relay read/write paths. Anything
  touching `hasRelay === true` branches must be verified in the running app.

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
- URL routing: `/app/desk`, `/app/folders`, `/app/people`, `/app/people/:id`; every file at `/<word>/<slug>-<d>` (FOL-39). `/topics` and `/topics/:id` only redirect (FOL-26).
- Clicking a message card opens the thread panel (the card body is the
  click target).

The demo seed (`dev/seedDemo`) and the "mutate a message on the deployment"
divergence trick that used to be here went with the Convex topics (FOL-23):
both were built on topic rows.

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

Run a local one instead:

```bash
cd ../estiva-id
pnpm db:up && pnpm migrate && pnpm seed && pnpm dev      # → :8787
EMAIL=harness@peek.test ROLE=member pnpm invite          # prints an invite URL
```

`.env` there needs `PEEK_REDIRECT_URIS=http://localhost:5173/auth/callback`
(exact-string matched). Then start Peek with
`VITE_ESTIVA_ID_ORIGIN=http://localhost:8787 npm run dev` and pass the invite
as `PEEK_VERIFY_INVITE_URL` — **registration requires an invite** (PEEK-65), so
a brand-new virtual authenticator has no credential to sign in with, and
invites are single-use so every cold run needs a fresh one.

### What a local Estiva ID proves — and what it can't

Verified end to end on 2026-08-17: passkey ceremony, `/authorize` redirect, and
the token landing in `sessionStorage`. The silent `prompt=none` probe even
carries the session left behind by enrolment, so the "Continue with passkey"
click is skipped entirely.

So local Estiva ID verifies **auth flows**. Verifying **data** — a live thread,
relay reads, publishing — has so far meant the production issuer. The reason
recorded here was Convex's (it could not fetch a `localhost` issuer's
configuration, and answered 401), and Convex is gone since REM-7; whether a
relay accepts a local issuer's token has not been measured.

Other consequences for driving the app:

- Unauthenticated → the shell settles on a single **"Continue with passkey"**
  button after one silent `prompt=none` probe.
- Anything behind `usesEstivaId` — publishing, relay reads, foreign-object
  widgets — is inert without a token, and fails by rendering **nothing**
  rather than erroring. A quiet screen is the expected shape when unsigned,
  not a bug to chase.

## Measure a story

Render it in Peek's Storybook (`npm run storybook`, `:6006`) and compare
against the package component it is built from on `:6008`: height, radius,
padding, colour. The gitignored `.verify-*.mjs` scripts in this repository
drive Chrome and compare computed styles; `.verify-shots/README.txt` explains
the pixel diff. `scripts/render-story.mjs` renders a story from a static
build and prints what it measures. "It looks right" is not a result.

**Restart Storybook** after any change to Tailwind config, the package
version, or a file you replaced with a re-export.

## Gotchas

- Screenshots: 1600×950 viewport matches the design reference well.
