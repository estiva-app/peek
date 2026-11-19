---
name: verify
description: Use to prove a Peek change works in the running app — the smoke test's Peek part against a local build or production, the QA probe for a ticket's own check, or a story measured in Storybook.
---

# Verifying Peek changes at the running app

## The smoke test's Peek part

The smoke test ([estiva-app/smoke](https://github.com/estiva-app/smoke), checked out beside this repository as
`../smoke`) walks the core flows on production as two test accounts of its own. Peek takes part in flows 1–7 and 10;
its section of `../smoke/CORE-FLOWS.md` says what a person sees in each. `/land` runs every flow after each deploy.

Against a local build, served at peek.estiva.app to the test's browser only, so sign-in and the relay behave as on
production while everyone else keeps the live app:

```bash
VITE_RELAY_URL=https://estiva.estiva.app npm run build
cd ../smoke && npm ci && node run.mjs --flow 1,2,3,4,5,6,7,10 --serve peek=$OLDPWD/dist
```

Against production, drop `--serve`. It exits 0 when every step passed or is known, 1 on a failed step (its screenshot
is in `out/<time>/`), 2 when it could not run. A change to how a core flow looks or works changes its step in the
smoke repository in the same work (`../smoke/README.md`).

## A ticket's own check

What is not a core flow is checked by the ticket's Done when, as QA-1 or QA-2, on production:

```bash
node scripts/probe.mjs --as qa1 --url /app/teams --until "!!document.querySelector('main a')" \
  --eval "document.querySelector('main')?.innerText"
```

`PROBE_SERVE=<dist>` runs an unmerged build at the real origin the same way (`scripts/probe.mjs` lists every step).
Never publish test data to the production relay that you do not delete again.

## Running it locally

`npm run dev` → http://localhost:5173, reading the relay `VITE_RELAY_URL` in `.env.local` names (production's is the
team's real data). It must be port 5173: Estiva ID compares `redirect_uri` exactly, and on 5174 sign-in dies with
"That redirect_uri is not registered for this app". Unit tests and Storybook run with no relay, so a relay read or
write is proved only in the running app.

Signing in a local build with a passkey needs a virtual authenticator against a local Estiva ID:
`.claude/skills/verify/scripts/signedIn.mjs`, which refuses `https://id.estiva.app` unless `PEEK_VERIFY_ALLOW_PROD=1`,
since a passkey registered there is a real credential nobody can use again. Its header says how to start Estiva ID
locally and pass an invite.

## Measure a story

Render it in Peek's Storybook (`npm run storybook`, `:6006`) and compare against the package component it is built
from on `:6008`: height, radius, padding, colour. `scripts/render-story.mjs` renders a story from a static build and
prints what it measures. "It looks right" is not a result. Restart Storybook after a change to the Tailwind config,
the package version, or a file you replaced with a re-export. Screenshots: a 1600×950 viewport matches the design
reference.
