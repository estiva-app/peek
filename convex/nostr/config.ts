/**
 * What the browser needs to talk to the relay itself (PEEK-106).
 *
 * The relay origin lives in `NOSTR_RELAY_URL`, a Convex environment variable,
 * and until publishing moved into the browser only the backend needed it.
 *
 * **Deliberately a query rather than a second `VITE_` build-time variable.**
 * The deploy builds both halves in one step (`npx convex deploy --cmd 'npm run
 * build'`) precisely so they cannot drift, and a bundle carrying its own copy
 * of the relay origin would reintroduce that — with the worst failure mode
 * available, since an unset origin means publishing is silently OFF rather
 * than broken. Reading it from the deployment keeps one source.
 *
 * Not a secret: it is a public hostname that every published event announces.
 *
 * This is all that is left of `nostr/bridge.ts`. The rest of that file — the
 * relay client, `signAs`, and the custodied-key branch that had been dead since
 * PEEK-40 — went with the actions that used it.
 */
import { query } from '../_generated/server'

/** Where to publish. Publishing is OFF unless this is set — that is the flag. */
export function relayUrl(): string | null {
  const url = process.env.NOSTR_RELAY_URL?.trim()
  return url ? url.replace(/\/+$/, '') : null
}

export const relayConfig = query({
  args: {},
  handler: async (): Promise<{ relayUrl: string | null }> => ({ relayUrl: relayUrl() }),
})
