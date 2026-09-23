# How to run Peek (simple guide)

*Written 2026-07-08, checked against the code 2026-09-23 —
if something here doesn't match what you see, ask Claude to update it.*

## The picture in plain words

- The app you see in the browser is the **storefront**.
- The **relay** (the Estiva relay) is where messages live. It is the source
  of truth: other Estiva apps read the same messages.
- **Convex** (a database in the cloud) is a **storage room** beside it. It
  keeps copies and lists Peek needs to be quick.
- **Sign-in is Estiva ID, with a passkey.** There is no password and no
  login of Peek's own. When you are already signed in to Estiva ID, Peek
  lets you in by itself; otherwise it shows one button to use your passkey.

## Running the app

1. `npm run dev` (the app)
2. Open http://localhost:5173.

**It must be port 5173.** Estiva ID only sends you back to addresses it
knows, and it knows `localhost:5173`, not `5174`. If something else already
holds 5173, stop it first.

## Which backend it talks to

The app reads three settings from `.env.local` (restart `npm run dev` after
you change it):

| Setting | What it is | When it is empty |
|---|---|---|
| `VITE_CONVEX_URL` | the Convex deployment | no Convex |
| `VITE_RELAY_URL` | the relay | no relay |
| `VITE_ESTIVA_ID_ORIGIN` | where you sign in | `https://id.estiva.app` |

- **The live backends:** `VITE_CONVEX_URL` is
  `https://honorable-guineapig-592.eu-west-1.convex.cloud` and
  `VITE_RELAY_URL` is `https://estiva.estiva.app`. That is the team's real
  data. Look, don't wipe.
- **No backend at all:** leave both `VITE_CONVEX_URL` and `VITE_RELAY_URL`
  empty. There is no sign-in, and the app shows the sample data from
  `src/data/`. The quickest way to look at the screens.

Since 23 September the relay address is set here, not read from Convex.
Without `VITE_RELAY_URL`, everything that reads the relay stays empty.

## The demo dataset is kept forever (decision 2026-07-08)

The sample data is preserved in two places and will never be deleted:

- `src/data/` — the sample conversations as code (also what tests and
  Storybook use).
- `convex/dev/seedDemo.ts` — the loader that fills a Convex deployment
  with that sample data.

**Only ever run it against a deployment of your own, never the live one.**

| What you want | Command |
|---|---|
| Look inside the database (opens a website) | `npx convex dashboard` |
| A brand-new, **empty** workspace | `npx convex run dev/seedDemo:wipe` |
| The **demo dataset**, with you as "Cath" | `npx convex run dev/seedDemo:seedAs '{"pubkey": "<64 hex>", "wipe": true}'` |

`seedAs` puts your Estiva ID key on Cath, the person the sample
conversations belong to, so signing in lands you on her.

`npx convex dev` pushes this folder's `convex/` code to the deployment it is
set up for. Never let it point at the live one.

## Where it runs

- **peek.estiva.app** is the real app. A push to `main` deploys it by
  itself (`.github/workflows/deploy.yml`): the Convex backend first, then
  the app, and the server picks it up within two minutes. Nobody runs
  `npx convex deploy` by hand.
- Two older Vercel copies still answer, **peek-demo.vercel.app** and
  **peek-develop.vercel.app**. Neither is the real app, and peek-develop
  talks to an old Convex deployment (`patient-grouse-611`).

## Cheat sheet

| I want to… | How |
|---|---|
| See the screens with sample data | both backend settings empty, `npm run dev` |
| Use the real app | https://peek.estiva.app |
| Run the real app locally | the live backend settings, `npm run dev`, sign in with your passkey |
| Look at the parts | `npm run storybook` → http://localhost:6006 |
