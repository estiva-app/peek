/**
 * What the browser needs to talk to the relay itself (PEEK-106).
 *
 * The relay origin lives in `NOSTR_RELAY_URL`, a Convex environment variable,
 * and until now only the backend ever needed it. Moving publishing into the
 * browser means the browser needs it too.
 *
 * **Deliberately a query rather than a second `VITE_` build-time variable.**
 * The deploy builds both halves in one step (`npx convex deploy --cmd 'npm run
 * build'`) precisely so they cannot drift, and a bundle carrying its own copy
 * of the relay origin would reintroduce exactly that drift — with the worst
 * possible failure mode, since an unset origin means publishing is silently
 * OFF rather than broken. Reading it from the deployment keeps one source.
 *
 * Not a secret: it is a public hostname that every published event announces.
 */
import { query } from '../_generated/server'
import { relayUrl } from './bridge'

export const relayConfig = query({
  args: {},
  handler: async (): Promise<{ relayUrl: string | null }> => ({ relayUrl: relayUrl() }),
})
