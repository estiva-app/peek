/**
 * Scheduled jobs.
 *
 * Only the Nostr read path so far. `syncChannels` no-ops immediately when
 * `NOSTR_RELAY_URL` is unset, so this costs nothing when the integration is off
 * — which is its default state.
 */
import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// 30s is a compromise: polling the HTTP bridge is the only option from Convex's
// request-scoped runtime (no long-lived WebSocket), so this trades latency
// against load. Real-time would mean an external consumer holding a NIP-01 REQ
// subscription and pushing into Convex — see convex/nostr/sync.ts.
crons.interval('nostr: pull relay events', { seconds: 30 }, internal.nostr.sync.syncChannels, {})

export default crons
