# Peek

Peek is Estiva's team-communication app: DMs, Topics, Huddles, the
Screener and the Desk. It runs at https://peek.estiva.app.

Its screens are built from the shared package `@estiva-app/ui`. Its
messages live on the Estiva relay; Convex keeps a projection beside it.

## Run it

```bash
npm ci
npm run dev          # the app on http://localhost:5173
npm run storybook    # the parts on http://localhost:6006
```

`HOW-TO-RUN.md` says which backend the app talks to, and how to switch.

## Check it

```bash
npx tsc -b           # typecheck, the same as the build
npm run test:run     # the tests
npm run lint:rules   # the gate lint
npm run lint:tokens  # the token lint
```

A push to `main` deploys: `.github/workflows/deploy.yml`.

## For Claude sessions

`CLAUDE.md` is the index of the rules.
