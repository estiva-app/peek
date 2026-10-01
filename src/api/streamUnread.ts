import type { ConversationMessage } from '@estiva-app/interop'
import { encodeNpub } from '@estiva-app/protocol'
import { isUnread } from '@estiva-app/conversation'

/** What a stream is judged against besides its messages. */
export interface StreamFrontier {
  /** The merged read state: context → unix seconds (`ReadFrontier.merged`). */
  merged: Readonly<Record<string, number>>
  /** The viewer's pubkey; their own messages do not count. */
  me: string | undefined
  /** Now, unix seconds. */
  nowSeconds: number
  horizonSeconds: number
}

/** The terms a stream is told about on: SPEC §11.8's membership, join time and mute. */
export interface StreamTerms {
  member: boolean
  since?: number
  muted: boolean
}

/**
 * Is anything in this stream unread for the viewer — SPEC §11.8's four
 * conditions over §11.3's markers, judged by `@estiva-app/conversation`.
 *
 * `context` is the stream's read-state context (§11.1): `fileContext(address)`
 * for a file, `channelContext(uuid)` for a Folder's general stream. A message is
 * judged against its thread's marker as well as the stream's (§11.3).
 *
 * The messages Peek holds are the interop projection — id, time, author, root
 * — which has no body, so whether one *names the viewer* comes from
 * `isMentioned` (the ids the relay's `#p` read returned) and is handed to the
 * package as the body it would have had. Without a marker, a file member is
 * told from the second they joined; a Folder's roster carries no join time, so
 * absence there is the horizon (§11.6).
 */
export function streamHasUnread(
  messages: readonly ConversationMessage[],
  context: string,
  terms: StreamTerms,
  frontier: StreamFrontier,
  isMentioned: (messageId: string) => boolean,
): boolean {
  const { me } = frontier
  if (!me) return false
  // Only for a message that names the viewer, so a viewer without a hex key judges the rest.
  const named = () => `nostr:${encodeNpub(me)}`
  const judge = {
    stream: context,
    me,
    member: terms.member,
    since: terms.since,
    muted: terms.muted,
    floor: frontier.nowSeconds - frontier.horizonSeconds,
  }
  for (const message of messages) {
    const root = message.root === message.id ? undefined : message.root
    const unread = isUnread(
      { id: message.id, pubkey: message.by, kind: 1111, created_at: message.at, tags: [], content: isMentioned(message.id) ? named() : '' },
      root,
      frontier.merged,
      judge,
    )
    if (unread) return true
  }
  return false
}
