/**
 * Where else a topic was named — the mentions half of Activity (CON-11).
 *
 * ## A mention is the `a` tag, not the body
 *
 * A person writing another topic into a message picks it from the `[` menu,
 * which serialises to `nostr:naddr…` in the body (RIC-11), and Peek's publish
 * path carries every such address as an `a` tag on the event
 * (`convex/nostr/refs.ts`, `referencedAddresses`). The body is the source and
 * the tag is the index — one `#a` filter answers "who named this topic" across
 * every channel the viewer can read, where reading bodies would mean reading
 * every channel. It is also the rule `partitionByRelation` already applies one
 * level down: *tagged, never merely named*. The relay's own mention index is
 * `p`-tag based and knows nothing about addresses, so this is not it.
 *
 * ## Both message kinds, every channel but this one
 *
 * A Peek topic's talk is `kind:9` and a file's conversation is `kind:1111`, and
 * either can name a topic. What is excluded is the topic's own channel: a
 * message there that names the topic it is in is already in the stream, and
 * *identity merges* — it would be the same message twice.
 *
 * Nothing is thrown away for having an `e` tag. A reply that carries the
 * address is still somebody naming the topic, and the row opens the topic it
 * was said in rather than a thread, so a reply and a root read the same way.
 *
 * The relay decides what the viewer sees: a mention written in a Folder they
 * are not a member of is absent from the answer, not refused. What *is*
 * refused — a dead token, an outage — surfaces as `RelayReadError` so the hook
 * can keep the last answer rather than draw an empty list.
 */
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import { queryRelay } from './bridge'
import { RelayReadError } from './relayRead'
import { attachmentsOf, type RelayAttachment } from './fileConversation'
import { TOPIC_KIND } from './manifest'

/** One message, in some other channel, that names this topic. */
export interface TopicMention {
  id: string
  /** The author's pubkey. */
  author: string
  body: string
  /** Seconds, as the event carries it. */
  createdAt: number
  kind: number
  /** The channel it was said in — its `h`. What the row says, and where it opens. */
  folder: string
  /** That channel as a topic's address, `39000:<relay>:<h>` — the relay key is
   *  the mentioned address's own, since one key signs every channel record
   *  (RFC 0.4 §5.3). What an Activity row's label is looked up by. */
  saidIn: string
  /** Every address it names, the mentioned topic included, in tag order. */
  references: string[]
  files: RelayAttachment[]
}

/**
 * Enough for a Folder panel that is scanned, not read. The list is newest
 * first, so what a cap drops is the oldest mention, which is the right end.
 */
export const TOPIC_MENTIONS_LIMIT = 200

/** The one filter: everything that tags the address, in either message kind. */
export function topicMentionFilter(address: string, limit = TOPIC_MENTIONS_LIMIT): Record<string, unknown> {
  return { kinds: [KIND.STREAM_MESSAGE, KIND.COMMENT], '#a': [address], limit }
}

const tagsNamed = (event: SignedEvent, name: string): string[] =>
  event.tags.filter((t) => t[0] === name && typeof t[1] === 'string' && t[1]).map((t) => t[1])

/**
 * The mentions among a relay answer: tagged with the address, said somewhere
 * other than `ownFolder`, newest first, one row per event.
 *
 * Pure, so the claim — a message in the topic's own channel is not a mention
 * of it — is provable without a relay.
 */
export function topicMentionsOf(
  events: readonly SignedEvent[],
  address: string,
  ownFolder: string,
): TopicMention[] {
  const seen = new Set<string>()
  const out: TopicMention[] = []
  const relayKey = address.split(':')[1] ?? ''
  for (const event of events) {
    if (seen.has(event.id)) continue
    const folder = tagsNamed(event, 'h')[0]
    if (!folder || folder === ownFolder) continue
    const references = [...new Set([...tagsNamed(event, 'a'), ...tagsNamed(event, 'A')])]
    if (!references.includes(address)) continue
    seen.add(event.id)
    out.push({
      id: event.id,
      author: event.pubkey,
      body: event.content,
      createdAt: event.created_at,
      kind: event.kind,
      folder,
      saidIn: `${TOPIC_KIND}:${relayKey}:${folder}`,
      references,
      files: attachmentsOf(event),
    })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Every message, in any channel the viewer can read, that names this topic.
 *
 * Throws {@link RelayReadError} on a refused read, like every read in
 * `foreign.ts`: an unreadable relay and a topic nobody has mentioned must not
 * be the same empty list.
 */
export async function topicMentionsAsViewer(
  address: string,
  ownFolder: string,
  relayUrl: string,
  token: StoredToken,
): Promise<TopicMention[]> {
  const result = await queryRelay(relayUrl, [topicMentionFilter(address)], token.accessToken, token.pubkey)
  if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
  return topicMentionsOf(result.events, address, ownFolder)
}
