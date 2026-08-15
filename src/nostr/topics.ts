/**
 * Establishing a topic's channel on the relay, from the browser (PEEK-106).
 *
 * The last path to move. It is the awkward one because it is not a single
 * event: a kind:9007 that creates the channel, then one kind:9000 per member.
 *
 * **The order matters and is not incidental.** The creator's accepted 9007 is
 * what establishes the Folder; memberships come after it so nobody is ever
 * handed a reference to a channel that does not exist. And the UUID is
 * persisted only once the relay has accepted the create — otherwise Ship and
 * `folderForTopic` could see a Folder id the relay has never heard of.
 *
 * Everything is signed by the **creator**, which is the whole reason this path
 * could not simply be dropped when custodial signing went away: a channel
 * published as whoever happened to be online would make the wrong person its
 * owner on the shared record, permanently. The browser doing the signing is the
 * creator's browser — `channelPlan` refuses anyone else.
 */
import type { StoredToken } from '@/auth/estivaId'
import { publishSigned, signViaEstivaId } from './bridge'
import { buildAddMember, buildCreateChannel } from '../../convex/nostr/events'

type ChannelPlan =
  | { ok: true; channelUuid: string; title: string; alreadyPublished: boolean; memberPubkeys: string[] }
  | { ok: false; reason: string }

export async function publishTopicChannel(
  topicId: string,
  relayUrl: string,
  token: StoredToken,
  api: {
    channelPlan: (args: { topicId: string }) => Promise<ChannelPlan>
    recordChannel: (args: { topicId: string; channelUuid: string }) => Promise<void>
  },
): Promise<{ ok: boolean; channelUuid?: string; reason?: string }> {
  const plan = await api.channelPlan({ topicId })
  if (!plan.ok) return { ok: false, reason: plan.reason }

  const created = await signAndSend(
    buildCreateChannel(token.pubkey, Date.now(), {
      channelUuid: plan.channelUuid,
      name: plan.title,
      visibility: 'open',
      channelType: 'stream',
    }),
    relayUrl,
    token,
  )
  // A duplicate create comes back as `accepted:false, "duplicate: channel
  // already exists"`, which `publishSigned` reports as ok — so re-running this
  // is safe in both directions.
  if (!created.ok) return { ok: false, reason: created.reason ?? 'relay rejected channel creation' }

  if (!plan.alreadyPublished) {
    await api.recordChannel({ topicId, channelUuid: plan.channelUuid })
  }

  for (const targetPubkey of plan.memberPubkeys) {
    const added = await signAndSend(
      buildAddMember(token.pubkey, Date.now(), {
        channelUuid: plan.channelUuid,
        targetPubkey,
        role: 'member',
      }),
      relayUrl,
      token,
    )
    // One refused membership must not abandon the rest, and never the channel:
    // it is already established and the topic is usable without them.
    if (!added.ok) console.warn(`[nostr] add-member rejected: ${added.reason}`)
  }

  return { ok: true, channelUuid: plan.channelUuid }
}

async function signAndSend(
  unsigned: Parameters<typeof signViaEstivaId>[0],
  relayUrl: string,
  token: StoredToken,
) {
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  return publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
}
