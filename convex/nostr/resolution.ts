/**
 * Peek's fold of the resolution assertions on the wire (PEEK-128).
 *
 * Left behind by SHA-3, deliberately. `buildResolution` — the `kind:9101` bytes —
 * went into `@estiva-app/protocol`, because the relay is what judges those and
 * two apps writing them differently is a divergence it would notice and we would
 * not. **This is the other half, and it is the half apps are supposed to differ
 * about.** Ship could read the same assertions and decide something else about
 * them; that is the point of the protocol, not a gap in it.
 *
 * `estiva-docs/decisions/0001` §8 puts it as: share the wire format, never the
 * interpretation. The package's README states the test for what belongs in it —
 * "would the relay notice if the two apps disagreed?" — and the answer for a
 * fold is no.
 *
 * It lived in `convex/nostr/events.ts` until the rest of that file moved out.
 */
import type { ResolutionAction } from '@estiva-app/protocol'

/**
 * Fold an ordered run of resolution assertions into the state Peek renders.
 *
 * Ordering is by `created_at`, then event id as a tiebreak — two assertions can
 * share a second, and without a stable tiebreak the same run would fold
 * differently on different clients.
 *
 * **Trust is applied by the caller, not here.** Pass only the assertions whose
 * authors the app is willing to let flip state (PEEK-128 decision 4); foreign
 * ones can still be displayed as history without being fed to this.
 */
export function foldResolution(
  assertions: Array<{
    id: string
    pubkey: string
    created_at: number
    action: ResolutionAction
    rationale?: string
  }>,
): { resolved: boolean; byPubkey?: string; atSeconds?: number; rationale?: string } {
  const ordered = [...assertions].sort(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  )
  const last = ordered[ordered.length - 1]
  if (!last) return { resolved: false }
  return last.action === 'resolved'
    ? { resolved: true, byPubkey: last.pubkey, atSeconds: last.created_at, rationale: last.rationale || undefined }
    : { resolved: false, byPubkey: last.pubkey, atSeconds: last.created_at }
}
