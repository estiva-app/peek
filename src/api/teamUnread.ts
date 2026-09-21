import type { StreamMessage } from '@/nostr/channelStreams'
import { containerContext, fileContext, threadContext } from '@/nostr/readState'
import { fileHasUnread } from './fileUnread'

/**
 * Is there something new anywhere in a team — SPEC §11.3, FOL-18.
 *
 * A Folder's indicator is the **union of its streams**: unread if its general
 * conversation is, or any file's conversation in it is. Each stream answers to
 * its own marker — the bare channel uuid for the general stream, the file's
 * bare address for a file's — and the channel's marker never reaches a file's
 * stream (§11.3): reading the team's chat says nothing about which of its
 * files you have read, so a team with an unread issue stays lit through any
 * amount of chat.
 *
 * It is a display rule computed here, at read time, from markers that already
 * exist. Nothing is written to express it and the reserved `folder:` grain
 * (§11.5) stays reserved — an app MUST NOT publish a marker for something the
 * person did not read, and "the team" is not something anybody reads.
 *
 * ## The same judge as the listing's dot
 *
 * Each stream is handed to `fileHasUnread` — the FOL-16 rule, unchanged, with
 * the stream's own marker where that takes the file's. So the team's dot and
 * the per-file dots under it cannot disagree: the team clears exactly when the
 * last file does, the thread frontier propagates the same way (§11.3), your
 * own messages never count, and absence is read by the 90-day horizon (§11.6)
 * for the general stream just as it is for a file's.
 *
 * ## Which stream a message is in
 *
 * Read off the message: an `a` names a file's stream — every `a`, because a
 * message about two files is in both — and none means the general stream.
 * That is §11.1's "the file's address for a root about that file", and it is
 * what `conversationsOf` counts for the file's own badge, so a message lights
 * the same rows on both surfaces. An `a` that is not an address names no
 * stream this rule knows and the message stays in the general one.
 *
 * "Any Folder beneath it" has no instance to judge: teams never nest (the
 * project brief, 2026-09-05), and if a tree ever draws one Folder under
 * another, the fold over children is the tree's, from this answer per Folder.
 *
 * ## Only the streams the person follows (FOL-30)
 *
 * The dot exists only for what you follow. Each stream is asked of `followed`
 * by its key — the file's address, or the Folder's own id for the general
 * stream — before it is judged, and an unfollowed stream contributes nothing
 * however new its messages are. Following a Folder follows its general chat;
 * following a file follows that file's talk; neither implies the other. Read
 * state is untouched by this: a marker still moves when the person visits, so
 * following later starts from where they last were.
 */
export function teamHasUnread(
  folderId: string,
  messages: readonly StreamMessage[],
  frontier: {
    /** One context's merged marker, unix seconds; absent = undefined. */
    marker: (context: string | undefined) => number | undefined
    /** Whether the person follows a stream — by file address, or by Folder id for the general one. */
    followed: (key: string) => boolean
    /** The viewer's pubkey; their own messages do not count. */
    me: string | undefined
    /** Now and the horizon, both unix seconds — the absent-marker rule needs them. */
    nowSeconds: number
    horizonSeconds: number
  },
): boolean {
  // Keyed by what a person follows, not by read-state context: the address
  // for a file's stream, the Folder's id for the general one.
  const streams = new Map<string, StreamMessage[]>()
  for (const message of messages) {
    const files = message.about.filter((address) => fileContext(address) !== undefined)
    for (const key of files.length > 0 ? files : [folderId]) {
      const stream = streams.get(key)
      if (stream) stream.push(message)
      else streams.set(key, [message])
    }
  }
  for (const [key, stream] of streams) {
    if (!frontier.followed(key)) continue
    const context = key === folderId ? containerContext(folderId) : fileContext(key)
    const unread = fileHasUnread(stream, {
      file: frontier.marker(context),
      thread: (root) => frontier.marker(threadContext(root)),
      me: frontier.me,
      nowSeconds: frontier.nowSeconds,
      horizonSeconds: frontier.horizonSeconds,
    })
    if (unread) return true
  }
  return false
}
