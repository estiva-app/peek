/**
 * Which DMs the viewer has hidden from their sidebar, as the relay says (DMS-6).
 *
 * Two halves, both the relay's design:
 *
 * - **`kind:41012`** is the request: "hide this DM for me". Peek signs and
 *   publishes it, naming the DM's channel. The relay sets the viewer's own
 *   `hidden_at` on their membership row and nothing else — the conversation,
 *   its participants and its history all survive, and the partner is not told.
 * - **`kind:30622`** is the answer: the relay's own, relay-signed snapshot of
 *   the viewer's hidden set, republished after every hide and every re-open.
 *   Parameterized replaceable on `d` = viewer, one `h` per hidden channel.
 *
 * ## The relay owns this state, and the snapshot is whole
 *
 * Convex holds no hidden flag and must not grow one: the snapshot is the truth,
 * a second copy would be a divergence waiting to happen, and the newest event
 * replaces the set wholesale — `hiddenChannelsOf` reads the latest and never
 * merges. The join from a channel uuid to the person it is with is the relay's
 * too — the channel's `39000` (`fetchDmChannels`) — so Convex has no part.
 *
 * ## Never sign a 30622
 *
 * It is relay-signed and result-gated on its `p` (`RESULT_GATED_KINDS`,
 * `filter.rs:reader_authorized_for_event`): the read that works is
 * `#p = me`, a `#p` naming anybody else is refused, and `ingest.rs` rejects a
 * client-authored one. So there is no builder for it, here or in the protocol
 * package, and `dmVisibilityFilter` is the whole of Peek's side.
 *
 * ## There is no unhide event
 *
 * `open_dm` clears the caller's `hidden_at` when the DM already exists and
 * republishes the snapshot on that path (`buzz-db/src/dm.rs`,
 * `command_executor.rs`). So the unhide is a second `kind:41010` —
 * `publishDmChannel` again — and Peek sends one when the viewer opens
 * a hidden DM. A message *arriving* in a hidden DM does not resurface it:
 * nothing on the relay's `kind:9` path touches `hidden_at` (measured against
 * `origin/nfb-demo-kinds`, the deployed branch), and Peek does not do it on
 * the relay's behalf either — the Screener is where an incoming DM surfaces,
 * and opening it from there is the re-open.
 */
import { KIND, buildDmHide, type SignedEvent } from '@estiva-app/protocol'
import type { RelaySeam } from './stars'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'

/** The one read that is authorised: the viewer's own snapshot, newest only. */
export function dmVisibilityFilter(pubkey: string): Record<string, unknown> {
  return { kinds: [KIND.DM_VISIBILITY], '#p': [pubkey], limit: 1 }
}

/**
 * The hidden set out of what the relay returned: the newest snapshot's `h`
 * tags, and nothing from any older one. No events means nothing was ever
 * hidden, which is an empty set and not an unknown.
 */
export function hiddenChannelsOf(events: SignedEvent[]): Set<string> {
  const newest = [...events].sort((a, b) => b.created_at - a.created_at)[0]
  if (!newest) return new Set()
  return new Set(newest.tags.filter((t) => t[0] === 'h' && typeof t[1] === 'string').map((t) => t[1] as string))
}

export type HiddenDmsRead = { state: 'present'; hidden: Set<string> } | { state: 'unreachable' }

/** Read the viewer's hidden set. `unreachable` is "did not answer", not "empty". */
export async function fetchHiddenDms(seam: RelaySeam): Promise<HiddenDmsRead> {
  const { ok, events } = await queryRelay(seam.relayUrl, [dmVisibilityFilter(seam.pubkey)], seam.accessToken, seam.pubkey)
  if (!ok) return { state: 'unreachable' }
  return { state: 'present', hidden: hiddenChannelsOf(events) }
}

export interface DmHideResult {
  ok: boolean
  reason?: string
}

/**
 * Hide one DM channel: the browser builds, signs and sends the `41012`.
 *
 * The channel is the one the relay's `39000` named (`fetchDmChannels`), so
 * there is nothing to look up first — until REM-3 Convex shaped this event only
 * because Convex was where the uuid was kept.
 *
 * Nothing is recorded back — there is nothing to record. The relay's answer to
 * a hide is the snapshot it republishes, and the caller re-reads that
 * (`fetchHiddenDms`) rather than trusting its own optimistic set for longer
 * than the round trip. A `duplicate` answer is still `ok`: the same hide sent
 * twice in one second is already applied.
 */
export async function publishDmHide(channelUuid: string, seam: RelaySeam): Promise<DmHideResult> {
  const unsigned = buildDmHide(seam.pubkey, Date.now(), { channelUuid })
  const signed = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
  const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
  if (!result.ok) return { ok: false, reason: result.reason ?? 'the relay refused the DM hide' }
  return { ok: true }
}
