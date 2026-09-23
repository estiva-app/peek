/**
 * Where the relay is, and whether there is one (REM-2).
 *
 * **A build-time value now, not a Convex query.** It used to be the relay
 * config query in `convex/nostr/config.ts`, which read the deployment's
 * `NOSTR_RELAY_URL`, on the reasoning that one source could not drift. What
 * that bought in practice was a Convex outage taking every relay feature down
 * with it — nineteen hooks waited on the query, including the viewer every
 * relay read goes through — while Convex is the thing being removed. The
 * production value is set in `.github/workflows/deploy.yml`.
 *
 * `undefined` under test, and wherever `VITE_RELAY_URL` is unset or empty
 * (Storybook pins it to `''`). That absence is the mock-mode switch for every
 * relay path: see `hasRelay`.
 *
 * Not a secret: it is a public origin that every published event announces.
 */
const configured =
  import.meta.env.MODE === 'test'
    ? undefined
    : (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim().replace(/\/+$/, '') || undefined

export const RELAY_URL: string | undefined = configured

/**
 * Whether this build talks to a relay — the mock-mode flag for relay paths.
 *
 * False in unit tests, in Storybook and in a checkout without `VITE_RELAY_URL`,
 * where the mock-backed internals answer instead. It is deliberately not
 * `hasConvex`: that one means "a Convex deployment is configured", and gating a
 * relay-only path on it switched the path off whenever Convex was absent.
 */
export const hasRelay = RELAY_URL !== undefined
