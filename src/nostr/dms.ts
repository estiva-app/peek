/**
 * A person's DM channels on the relay: which exist, and opening one (DMS-3, REM-3).
 *
 * ## Which exist — one read, no bookkeeping
 *
 * The relay describes every DM channel with a NIP-29 `kind:39000`, emitted when
 * `handle_dm_open` creates it (`command_executor.rs`), and for a DM it carries
 * what nothing else does: `["t","dm"]` and one `p` per participant
 * (`side_effects.rs`, `emit_group_discovery_events`). Those `p` tags are written
 * into the relay's mention index, so `{kinds:[39000], '#p':[me]}` is an indexed
 * read of exactly the DMs this person is in — and a DM they are not in is never
 * in their answer, because the query is scoped to their channels.
 *
 * Until REM-3 that list was Convex's `dmConversations`, a copy kept by the
 * browser writing back every uuid the relay told it. It is the relay's own fact,
 * so it is read from the relay, and a DM opened from another app is on the list
 * the moment the relay has it.
 *
 * A second filter, `#t=dm`, catches a DM whose `39000` was written before the
 * relay began tagging participants; its partner then comes from the channel's
 * `39002` member list. Both are asked in the same request.
 *
 * ## Opening one — the uuid travels back
 *
 * A topic's channel uuid travels *out*: the client mints it and tells the relay
 * what to create. A DM's travels *back*: the relay mints it — `Uuid::new_v4()`
 * in `create_dm` — and keys it by a hash of the participant set, so nobody else
 * chooses it, it cannot be computed from the participants, and the answer to
 * the `41010` is the only place a new one exists. Opening the same DM twice
 * always names the same channel, so "have these two people got a channel
 * already" is never a question worth asking — publish, and use what comes back.
 *
 * There is no `9007` here and there must not be: `41010` creates the channel
 * itself, and a create alongside it would be a second, differently-owned
 * channel for the same conversation.
 */
import { buildDmOpen, commandPayload, type SignedEvent, type UnsignedEvent } from '@estiva-app/protocol'
import { KIND_CHANNEL_METADATA } from '@estiva-app/interop'
import type { RelaySeam } from './stars'
import { publishSigned, signViaEstivaId } from './bridge'
import { readFrom, type ReadSource } from './readFrom'

/** NIP-29 group members — a channel's `p` roster, one tag per member. */
export const KIND_CHANNEL_MEMBERS = 39002

const tagValues = (event: SignedEvent, name: string) =>
  event.tags.filter((t) => t[0] === name && typeof t[1] === 'string').map((t) => t[1] as string)

/**
 * The two reads of "my DM channels", asked together. Each names exactly one
 * `#p` value: the relay pushes a single-value `#p` into its index and falls
 * back to a scan under the limit for more than one.
 */
export function dmChannelFilters(me: string): Record<string, unknown>[] {
  return [
    { kinds: [KIND_CHANNEL_METADATA], '#p': [me], limit: 500 },
    { kinds: [KIND_CHANNEL_METADATA], '#t': ['dm'], limit: 500 },
  ]
}

/**
 * The viewer's one-to-one DMs, partner pubkey → channel uuid, from the
 * `39000`s the relay returned (and the `39002`s for any that name nobody).
 *
 * Only a DM with exactly one other participant is a person's DM: a group DM
 * (up to eight others) has no single partner to key it by, and People has no
 * row for one. An archived channel is not a conversation to open.
 */
export function dmChannelsOf(
  metadata: readonly SignedEvent[],
  me: string,
  members: readonly SignedEvent[] = [],
): Map<string, string> {
  const rosterOf = new Map(members.map((m) => [tagValues(m, 'd')[0], tagValues(m, 'p')]))
  const byPartner = new Map<string, string>()
  // Newest first, so an older duplicate cannot displace the current answer.
  for (const event of [...metadata].sort((a, b) => b.created_at - a.created_at)) {
    if (!tagValues(event, 't').includes('dm')) continue
    if (event.tags.some((t) => t[0] === 'archived')) continue
    const uuid = tagValues(event, 'd')[0]
    if (!uuid) continue
    const participants = tagValues(event, 'p')
    const others = (participants.length ? participants : rosterOf.get(uuid) ?? []).filter((p) => p !== me)
    const unique = [...new Set(others)]
    if (unique.length !== 1) continue
    if (!byPartner.has(unique[0])) byPartner.set(unique[0], uuid)
  }
  return byPartner
}

/** DM channels whose `39000` names no participant, so the `39002` must. */
function untaggedDms(metadata: readonly SignedEvent[]): string[] {
  return metadata
    .filter((e) => tagValues(e, 't').includes('dm') && tagValues(e, 'p').length === 0)
    .flatMap((e) => tagValues(e, 'd'))
}

export type DmChannelsRead = { state: 'present'; byPartner: Map<string, string> } | { state: 'unreachable' }

/** Read the viewer's DM channels. `unreachable` is "did not answer", not "none". */
export async function fetchDmChannels(seam: RelaySeam, source: ReadSource = 'relay'): Promise<DmChannelsRead> {
  const first = await readFrom(source, seam.relayUrl, dmChannelFilters(seam.pubkey), seam.accessToken, seam.pubkey)
  if (!first.ok) return { state: 'unreachable' }
  const untagged = untaggedDms(first.events)
  let members: SignedEvent[] = []
  if (untagged.length) {
    const second = await readFrom(
      source,
      seam.relayUrl,
      [{ kinds: [KIND_CHANNEL_MEMBERS], '#d': untagged }],
      seam.accessToken,
      seam.pubkey,
    )
    if (!second.ok) return { state: 'unreachable' }
    members = second.events
  }
  return { state: 'present', byPartner: dmChannelsOf(first.events, seam.pubkey, members) }
}

export interface DmChannelResult {
  ok: boolean
  channelUuid?: string
  reason?: string
}

/**
 * Open the DM with `partner` — or re-open it, which is the same event.
 *
 * Re-opening is also the unhide (DMS-6): there is no unhide kind, and
 * `open_dm` clears the caller's `hidden_at` on a DM that already exists and
 * republishes their `30622`. The answer names the same uuid either way.
 */
export async function publishDmChannel(partner: string, seam: RelaySeam): Promise<DmChannelResult> {
  if (partner === seam.pubkey) return { ok: false, reason: 'a DM needs somebody else in it' }
  const unsigned = buildDmOpen(seam.pubkey, Date.now(), { otherPubkeys: [partner] })

  const first = await publish(unsigned, seam)
  if (!first.ok) return { ok: false, reason: first.reason }

  let channelUuid = first.channelUuid
  /*
    The race this exists for, measured on production 2026-09-17.

    Two tabs opening the same DM in the same wall-clock second build the same
    event — same author, same `p` tag, same `created_at` to the second — and
    therefore the same event id. `persist_command_event` keys on that id, so the
    second one is answered `accepted:true`, `"duplicate: already processed"`,
    and **no channel uuid**: the relay never re-ran the handler, so it has
    nothing to tell. The losing tab is not in an error state; it simply has not
    been told the answer yet.

    A *distinct* event re-runs the handler and is answered in full, with
    `created:false` and the same uuid — the participant keying makes that safe.
    One second into the future is the cheapest way to be distinct, and the relay
    accepts it (measured; a relay refusing a future timestamp would have made
    the escape a wait instead).

    Once, not in a loop: a second collision would mean a third tab landed in the
    same second as the retry, and re-publishing forever to chase it is worse
    than leaving the channel for the next open to learn.
  */
  if (!channelUuid && first.duplicate) {
    const retry = await publish({ ...unsigned, created_at: unsigned.created_at + 1 }, seam)
    if (!retry.ok) return { ok: false, reason: retry.reason }
    channelUuid = retry.channelUuid
  }

  if (!channelUuid) return { ok: false, reason: 'the relay accepted the DM open but named no channel' }
  return { ok: true, channelUuid }
}

/** One signed `41010`, and the channel uuid out of its answer. */
async function publish(
  unsigned: UnsignedEvent,
  seam: RelaySeam,
): Promise<{ ok: boolean; channelUuid?: string; duplicate?: boolean; reason?: string }> {
  const signed = await signViaEstivaId(unsigned, seam.accessToken, seam.pubkey)
  const result = await publishSigned(seam.relayUrl, signed, seam.accessToken, seam.pubkey)
  if (!result.ok) return { ok: false, reason: result.reason ?? 'the relay refused the DM open' }
  const channelId = commandPayload(result)?.channel_id
  return {
    ok: true,
    channelUuid: typeof channelId === 'string' ? channelId : undefined,
    duplicate: result.duplicate,
  }
}
