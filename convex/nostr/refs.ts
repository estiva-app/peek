/**
 * Pure helpers shared by the two halves of publishing.
 *
 * Extracted from `publish.ts` when signing moved to the browser (PEEK-106):
 * `outbox.ts` builds the unsigned event and `publish.ts` still owns the paths
 * that have not moved yet, and both need these. Kept in one place rather than
 * copied, because both feed the event id preimage — two copies drifting would
 * produce ids the relay computes differently, which is a silent divergence
 * rather than a duplicate.
 *
 * No Convex imports: this file is pure so either runtime can use it.
 */
import { decodeNaddr, findNaddrs, pointerToAddress } from '@estiva-app/protocol'

/**
 * The relay rejects any event whose `created_at` is more than ±15 minutes from
 * server time — `MAX_TIMESTAMP_DRIFT_SECS` in `handlers/ingest.rs:1480`,
 * hard-coded and applied to every ingested event, not just NIP-98 auth.
 *
 * Consequence: **Peek's existing history cannot be backfilled with its real
 * timestamps.** Live traffic is unaffected. Rather than falsify `created_at` to
 * sneak old messages past the check — which would corrupt the shared record for
 * every other app reading it — out-of-window messages are skipped and logged.
 *
 * Container events (channel create, membership, profile) are different: they
 * describe state we are establishing *now*, so they legitimately carry the
 * current time and an old topic can still be published.
 */
export const MAX_DRIFT_MS = 900_000

export function withinDriftWindow(createdAtMs: number): boolean {
  return Math.abs(createdAtMs - Date.now()) <= MAX_DRIFT_MS
}

/**
 * Preserve a pasted Ship reference as the explicit address association its
 * manifest declares for comments. Bad lookalikes stay ordinary message text.
 */
export function referencedAddresses(body: string): string[] {
  const addresses = new Set<string>()
  for (const naddr of findNaddrs(body)) {
    try {
      addresses.add(pointerToAddress(decodeNaddr(naddr)))
    } catch {
      // Text is free-form; one malformed pointer cannot block a message.
    }
  }
  return [...addresses]
}
