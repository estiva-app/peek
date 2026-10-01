/**
 * What the relay implies a person follows: the files they were named in (FOL-30).
 *
 * The ticket's other two defaults — you follow what you are @mentioned in, and
 * what someone places you on — are other people's actions, so no client of the
 * person's can write them at the moment they happen. They are read instead:
 * one `#p` filter, which the relay serves from its mention index whatever the
 * kind, over the three events that name a person about a file:
 *
 * - a `kind:1111` comment carrying `p` — a `nostr:npub` mention in its body
 *   (`mentionTagsFor`), or a reply to the person's own comment (`p` = parent
 *   author). Its `A` is the file.
 * - a `kind:9` message in a topic carrying `p`, the same two ways. Its `h` is
 *   the topic's Folder, which is the key a Folder is followed by.
 * - a `kind:1851` change placing the person — `assignee` on an issue, `lead`
 *   on a project — which Ship tags `p` since ship#169. Its `a` is the object.
 *
 * ## Read, not written
 *
 * The implied set is computed from the relay on every load rather than folded
 * into the blob, so every device agrees without a write and nothing is missed
 * while no tab was open. What *is* written is the exception: an unfollow of an
 * implied key goes to the blob's `muted`, or the next load would bring it back.
 * `followsToPublish` and `useFollowsSync` hold that half.
 *
 * Bounded by the read horizon Peek judges unread over (`PEEK_HORIZON_DAYS`) and
 * a limit: measured on production as the agent, the most-named identity there,
 * 700 events in 90 days named 228 keys. A person is named far less. Nothing
 * before the horizon can light a dot anyway (`fileHasUnread`, §11.6).
 */
import type { SignedEvent } from '@estiva-app/protocol'
import { KIND } from '@estiva-app/protocol'
import { queryRelay } from './bridge'
import { fileContext } from '@estiva-app/conversation'
import { PEEK_HORIZON_DAYS } from './readState'
import type { RelaySeam } from './stars'

/** Ship's change kind (`kind:1851`) — `@estiva-app/protocol` has no name for it yet. */
const KIND_CHANGE = 1851

export const IMPLIED_FOLLOWS_LIMIT = 1000

/** The one filter: everything in the horizon that names this person, of the three kinds that name a file. */
export function impliedFollowsFilter(pubkey: string, nowSeconds: number, limit = IMPLIED_FOLLOWS_LIMIT): Record<string, unknown> {
  return {
    kinds: [KIND.COMMENT, KIND.STREAM_MESSAGE, KIND_CHANGE],
    '#p': [pubkey],
    since: nowSeconds - PEEK_HORIZON_DAYS * 24 * 60 * 60,
    limit,
  }
}

const tag = (event: SignedEvent, name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The key each event implies, or nothing: a file address for a comment or a
 * placement, a Folder id for a topic message. An event whose anchor is not a
 * well-formed key implies nothing rather than a key nobody could follow.
 */
export function impliedKeyOf(event: SignedEvent): string | undefined {
  switch (event.kind) {
    case KIND.COMMENT:
      return fileContext(tag(event, 'A'))
    case KIND.STREAM_MESSAGE: {
      const h = tag(event, 'h')
      return h && UUID_RE.test(h) ? h.toLowerCase() : undefined
    }
    case KIND_CHANGE:
      return fileContext(tag(event, 'a'))
    default:
      return undefined
  }
}

/**
 * Each implied key with the time, epoch ms, of the newest event that names
 * the person in it. The time is what a mute is judged against: a mute covers
 * the namings before it, and a newer one follows the key again (`follows.ts`).
 */
export function impliedKeysOf(events: readonly SignedEvent[]): Map<string, number> {
  const keys = new Map<string, number>()
  for (const event of events) {
    const key = impliedKeyOf(event)
    if (!key) continue
    const at = event.created_at * 1000
    if ((keys.get(key) ?? 0) < at) keys.set(key, at)
  }
  return keys
}

/** The implied set, or `undefined` when the relay did not answer — never an empty guess. */
export async function fetchImpliedFollows(seam: RelaySeam, nowSeconds = Math.floor(Date.now() / 1000)): Promise<Map<string, number> | undefined> {
  const { ok, events } = await queryRelay(seam.relayUrl, [impliedFollowsFilter(seam.pubkey, nowSeconds)], seam.accessToken, seam.pubkey)
  return ok ? impliedKeysOf(events) : undefined
}
