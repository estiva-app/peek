/**
 * Where else a file was named — the mentions half of a file's Activity (CON-11).
 *
 * ## The `a` tag finds it, the latest words confirm it
 *
 * A person writing another file into a comment picks it from the `[` menu,
 * which serialises to `nostr:naddr…` in the body, or pastes its link, and
 * `commentAsViewer` carries every such address as an `a` tag — and an edit
 * the `a` its new words earn (PEEKM-7). The tag is the index — one `#a` filter
 * answers "who named this file" across every Folder the viewer can read, where
 * reading bodies would mean reading every conversation — and the message's
 * latest words are the source: a row lists while they still link the file
 * (interop's `readMentionedIn`). The relay's own mention index is `p`-tag
 * based and knows nothing about addresses, so this is not it.
 *
 * ## Both message kinds, every conversation but this file's own
 *
 * A file's conversation is `kind:1111` and a topic's talk is `kind:9`, and
 * either can name a file: a topic message carries every `[`-menu reference as
 * `a` too (RIC-11, `convex/nostr/refs.ts`). The same `#a` read is how a file's
 * *own* comments are found (`resolveForeignObject`), so the answer holds both
 * strengths and SPEC §6.4's per-tag rule tells them apart, as
 * `@estiva-app/conversation` reads it (CON-13, CON-14, CON-5). A `kind:1111`
 * whose thread is about this file (its `A`) is its conversation, root or
 * reply, and *identity merges* — it is already in the stream; one whose `A`
 * is another file is that file's conversation and this file's Activity. A
 * `kind:9` is chat: whatever `a` it carries, it is a mention, said in its
 * topic (CON-20 moved the pre-REW-10 comment anchors to `kind:1111`).
 *
 * Nothing is thrown away for having an `e` tag. A reply that carries the
 * address is still somebody naming the file, and the row opens the thread it
 * was said in, so a reply and a root read the same way.
 *
 * A `kind:9` row is said in a topic, and a topic's address is
 * `39000:<relay-pubkey>:<h>` (RFC 0.4 §5.2) — so the read fetches the relay's
 * key once (`relaySigningKeyAsViewer`), only when the answer holds one. A
 * relay serving no channel record this viewer can read has no topic they
 * could open either, so those rows are left out rather than spelled wrong.
 *
 * The relay decides what the viewer sees: a mention written in a Folder they
 * are not a member of is absent from the answer, not refused. What *is*
 * refused — a dead token, an outage — surfaces as `RelayReadError` so the hook
 * can keep the last answer rather than draw an empty list.
 */
import { embedsOf, KIND, type Embed, type SignedEvent } from '@estiva-app/protocol'
import { readMentionedIn, type MentionedIn, type QueryFn } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import { parentOf } from '@estiva-app/conversation'
import { attachmentsOf, decorate, urgentOf, type ConversationEvent, type FileConversation, type RelayAttachment } from './fileConversation'
import { linkReaderAsViewer, relaySigningKeyAsViewer, viewerQuery } from './foreign'
import { TOPIC_KIND } from './manifest'

/** One comment in some other file's conversation, or one topic message, that names this file. */
export interface FileMention {
  id: string
  /** The author's pubkey. */
  author: string
  body: string
  /** Seconds, as the event carries it. */
  createdAt: number
  kind: number
  /** The Folder it was said in — its `h`. */
  folder: string
  /**
   * Where it was said, as an address — what the row says, and where it opens.
   * A comment's is the file it was said on, NIP-22's `A`; a topic message's is
   * its topic, `39000:<relay-pubkey>:<h>`.
   */
  saidIn: string
  /** The thread it belongs to there: the parent a reply names by `e`, or itself. */
  threadId: string
  /** Every address it names, the mentioned file included, in tag order. */
  references: string[]
  /** Whom it names urgently — its `urgent` tags (SPEC §13.1, CON-24). */
  urgent: string[]
  files: RelayAttachment[]
  /** The cards its author asked for — its `embed` tags (SPEC §13.6.2). Absent: none. */
  embeds?: Embed[]
}

const tagsNamed = (event: SignedEvent, name: string): string[] =>
  event.tags.filter((t) => t[0] === name && typeof t[1] === 'string' && t[1]).map((t) => t[1])

/**
 * The rows Mentioned in draws, from interop's reading of it (`mentionedInOf`,
 * newest first): each message as its latest words say, said somewhere other
 * than this file's own conversation. `relayKey` spells a topic message's
 * `saidIn`; without one those rows are left out (the module header says why).
 */
export function fileMentionsOf(mentioned: readonly MentionedIn[], relayKey?: string | null): FileMention[] {
  const out: FileMention[] = []
  for (const { event, body, edit } of mentioned) {
    const folder = tagsNamed(event, 'h')[0]
    const saidIn =
      event.kind === KIND.STREAM_MESSAGE
        ? relayKey && folder
          ? `${TOPIC_KIND}:${relayKey}:${folder}`
          : undefined
        : tagsNamed(event, 'A')[0]
    if (!saidIn || !folder) continue
    out.push({
      id: event.id,
      author: event.pubkey,
      body,
      createdAt: event.created_at,
      kind: event.kind,
      folder,
      saidIn,
      threadId: tagsNamed(event, 'e')[0] ?? event.id,
      // What it names now: the latest edit's `a` when there is one (§6.8), and where it was said.
      references: [...new Set([...tagsNamed(edit ?? event, 'a'), ...tagsNamed(event, 'A')])],
      urgent: urgentOf(event),
      files: attachmentsOf(event),
      embeds: embedsOf(event),
    })
  }
  return out
}

/**
 * Every comment on any file, and every topic message in any channel, the
 * viewer can read whose latest words name this file — by `nostr:` reference
 * or by an app link, an edit's words included (interop's `readMentionedIn`,
 * through the viewer's link reader, PEEKM-7).
 *
 * Throws `RelayReadError` on a refused read, like every read in
 * `foreign.ts`: an unreadable relay and a file nobody has mentioned must not
 * be the same empty list. The relay's key is a second read, paid only when a
 * topic message is in the answer; `relaySigningKeyAsViewer` answers `null`
 * for a refused read too, and those rows are then left out of an answer the
 * comments are still in.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-says-what-the-message-links-now.md
 */
export async function fileMentionsAsViewer(address: string, relayUrl: string, token: StoredToken): Promise<FileMention[]> {
  const mentioned = await readMentionedIn(viewerQuery(relayUrl, token), address, { links: linkReaderAsViewer(relayUrl, token) })
  const relayKey = mentioned.some((m) => m.event.kind === KIND.STREAM_MESSAGE) ? await relaySigningKeyAsViewer(relayUrl, token) : null
  return fileMentionsOf(mentioned, relayKey)
}

/*
  ## Each mention as it is now (PEE-48)

  A row in Activity is the message as it stands where it was said: its edits,
  its reactions, its replies, whether it was resolved. None of that is on the
  mention itself — each names the message by `e` — so it is read after the
  mentions, for their ids, and folded exactly as a conversation folds its own
  (`decorate`, then `project` in the view). A deleted message needs nothing
  here: the relay drops it, and the `#a` read above no longer returns it.
*/

/** How many replies one read asks for — Buzz's clamp per filter. */
const MENTION_REPLIES_LIMIT = 1_000

/**
 * The replies in each mention's thread, by the mention's id, oldest first.
 *
 * Only a mention that opens a thread has any: one that is itself a reply is
 * drawn as a message, with no thread of its own to count — as a reply is in
 * the thread it was said in. A reply is filed by `parentOf`, which names the
 * thread for both kinds (SPEC §6.4): a `kind:1111` reply's `e` is its thread's
 * top comment, and a `kind:9` reply's `root`-marked `e` is its thread.
 */
export function mentionRepliesOf(events: readonly SignedEvent[], threadIds: ReadonlySet<string>): Record<string, SignedEvent[]> {
  const seen = new Set<string>()
  const out: Record<string, SignedEvent[]> = {}
  for (const event of events) {
    if (seen.has(event.id) || threadIds.has(event.id)) continue
    if (event.kind !== KIND.COMMENT && event.kind !== KIND.STREAM_MESSAGE) continue
    const parent = parentOf(event)
    if (!parent || !threadIds.has(parent)) continue
    seen.add(event.id)
    ;(out[parent] ??= []).push(event)
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
  return out
}

/**
 * The mentions as one conversation, `project`'s input: each mention a root,
 * its thread's replies under it, and what has been done to every one of them.
 * Which messages are mentions is already the latest words' answer
 * ({@link fileMentionsAsViewer}): an edit that took the file out took the row
 * out (PEE-48, Katerina, 8 October), and one that linked it put it in.
 *
 * Two reads after the mentions: the replies by `#e`, then `decorate`'s. Throws
 * `RelayReadError` on a refused read, so a failure keeps the rows as they
 * were rather than drawing every message as never touched.
 */
export async function mentionConversationWith(mentions: readonly FileMention[], query: QueryFn): Promise<FileConversation> {
  const asEvent = (event: SignedEvent): ConversationEvent => ({
    id: event.id,
    author: event.pubkey,
    body: event.content,
    createdAt: event.created_at,
    kind: event.kind,
    files: attachmentsOf(event),
    references: [],
    urgent: urgentOf(event),
    embeds: embedsOf(event),
  })
  const roots: ConversationEvent[] = mentions.map((m) => ({
    id: m.id,
    author: m.author,
    body: m.body,
    createdAt: m.createdAt,
    kind: m.kind,
    files: m.files,
    references: m.references,
    urgent: m.urgent,
    embeds: m.embeds,
  }))
  const threadIds = new Set(mentions.filter((m) => m.threadId === m.id).map((m) => m.id))
  const events = threadIds.size
    ? await query([{ kinds: [KIND.COMMENT, KIND.STREAM_MESSAGE], '#e': [...threadIds], limit: MENTION_REPLIES_LIMIT }])
    : []
  const replies: Record<string, ConversationEvent[]> = {}
  for (const [id, list] of Object.entries(mentionRepliesOf(events, threadIds))) replies[id] = list.map(asEvent)

  return decorate(roots, replies, query)
}

/** {@link mentionConversationWith} as the viewer. */
export function mentionConversationAsViewer(mentions: readonly FileMention[], relayUrl: string, token: StoredToken): Promise<FileConversation> {
  return mentionConversationWith(mentions, viewerQuery(relayUrl, token))
}
