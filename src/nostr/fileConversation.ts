/**
 * A file's conversation as Peek's own — the reads and writes behind the
 * Topics view on `kind:1111` (FOL-31).
 *
 * **One conversation, parameterised by container.** Peek's Topics view reads
 * `kind:9` in a channel through Convex; a file's conversation is `kind:1111`
 * on the relay, read by `#a`. The view is the same set of components either
 * way; what differs is here, and this module is the only place a kind number
 * for a file's talk is written. `ConversationContainer` is the DMS-5
 * `containerKind`/`containerKey` idea with the file as a member. REM-1 added
 * its second shape, `{ kind: 'channel', h }`: a channel's `kind:9` talk, read
 * by `#h` and written with `buildMessage` — a DM today, and a team's general
 * chat when FOL-35 wants it. The same view, one more branch in this file.
 *
 * ## A channel
 *
 * Threaded by `@estiva-app/conversation`'s `groupThreads` (SPEC §6.4, CON-5):
 * a `kind:9` with an `e` is a reply, filed under its thread's root — a nested
 * reply under the `root`-marked `e`, not its parent — and one without is a
 * message. A reply to something that is not a message here is dropped rather
 * than guessed at. Edits, reactions and resolutions are the same `#e` read a
 * file's comments get. A deleted message is simply not returned.
 *
 * ## Reads
 *
 * The roots come with the file (`resolveForeignObject`, `#a`-scoped); a reply
 * carries no `a`, so the thread read asks by `#e` (interop's `threadsOf`, which returns the events);
 * and what has been done to any of them — an edit, a reaction, a resolution —
 * names the comment rather than the file, so it is a third read by `#e`
 * (`@estiva-app/conversation`'s `decorationsOf`, CON-5). Three round trips, each for a
 * reason that is NIP-22's and not this module's.
 *
 * ## Writes
 *
 * A comment is the owner's `comment` action, exactly as `applyActionAsViewer`
 * publishes it, with the composer's attachments as `imeta` (CON-12), its
 * mentions as `p`, and every file its body names as `a` (CON-11 — the
 * mention is the tag). Everything else is a plain protocol event at the comment:
 * `kind:40003` to edit (CON-8), `kind:5` to delete or to take a reaction back
 * (CON-3 — the relay adjudicates, the client does not pre-judge), `kind:7` to
 * react, `kind:9101` to resolve or reopen (PEEK-128). No Convex row is written
 * for any of it: the relay is the only store a file's conversation has, so what
 * the page shows after a write is what it re-reads.
 */
import {
  buildDeletion,
  buildEdit,
  buildMessage,
  buildReaction,
  buildResolution,
  needsRelayKey,
  embedTag,
  embedsOf,
  imetaOf,
  imetaTag,
  KIND,
  blockRunOf,
  blockRunTag,
  partsOf,
  QUOTE_TAG,
  RELAY_BUSY_MESSAGE,
  type Embed,
  type Imeta,
  type NostrTag,
  type PartPointer,
  type PublishResult,
  type ResolutionAction,
  type SignedEvent,
  type UnsignedEvent,
} from '@estiva-app/protocol'
import {
  anchorsOf,
  byOrder,
  decorationsOf,
  foldEmbeds,
  ownFileOf,
  foldThreads,
  groupThreads,
  isCommentOn,
  KIND_EDIT,
  mentionTagsFor,
  parentOf,
  resolutionOf,
  URGENT_TAG,
  urgentTagsFor,
  type Decorations,
  type Resolution,
  type RootState,
  type Thread,
} from '@estiva-app/conversation'
import type { QueryFn, Threads } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import type { UnsignedActionEvent } from '@estiva-app/interop'
import { publishSigned, signViaEstivaId } from './bridge'
import { RATE_LIMIT_MAX_WAIT_MS, retryAfterMs } from './relayRead'
import {
  buildCommentAsViewer,
  fileCommentOf,
  threadEventsWith,
  linkTagsAsViewer,
  relaySigningKeyOnce,
  viewerQuery,
  type FileComment,
  type FileThreads,
} from './foreign'

/** Where a conversation lives; see the module header. */
export type ConversationContainer =
  | {
      kind: 'file'
      /** The file's address — what its comments carry as `a`. */
      address: string
      /** The file's Folder — what every event written into this conversation carries as `h`. */
      h: string
    }
  | {
      kind: 'channel'
      /** The channel — what every message in it carries as `h`, and all a read needs. */
      h: string
      /**
       * Only its general stream (§11.1): a team's chat (TEA-5), where a
       * message that names a file in an `a` is that file's conversation, not
       * the chat's. A DM's channel holds no file's talk and passes nothing.
       */
      general?: true
    }

/** What names a conversation, whatever its kind: the file's address, or the channel. */
export const conversationKeyOf = (container: ConversationContainer): string =>
  container.kind === 'file' ? container.address : container.h

/** An attachment as an `imeta` on the relay describes it — the shape `attachmentsOf` gives Convex. */
export interface RelayAttachment {
  name: string
  contentType: string
  size: number
  sha256: string
  mediaUrl: string
  thumbUrl?: string
  dim?: string
  /** The `imeta` as read, every field: what an edit lists again for a file it keeps. */
  imeta?: Imeta
}

/** A root or a reply, with its attachments and references read off its own tags. */
export interface ConversationEvent extends FileComment {
  files: RelayAttachment[]
  /** `a` tags, plus NIP-22's `A` — objects this comment is about, the file itself excluded. */
  references: string[]
  /** Whom the text names urgently — its `["urgent", <pubkey>]` tags (SPEC §13.1, CON-24). Absent: nobody. */
  urgent?: string[]
  /** The blocks of other objects it shows — its `part` tags (SPEC §13.6.1, COM-2). Absent: none. */
  parts?: ConversationPart[]
  /** The cards its author asked for — its `embed` tags (SPEC §13.6.2). Absent: none. */
  embeds?: Embed[]
  /** The values naming the file it is on, its `A` and `O`: a line that is only a link to it draws nothing (ONE-11). */
  ownFile?: string[]
  /**
   * Its `actor` and `p` tags: with its signer, whose message it is when the relay signed it for someone
   * (`effectiveAuthor`, SPEC §6.5) — what a reaction to it names (ACT-6). Absent: none, so it is its signer's.
   */
  authorship?: string[][]
  /**
   * A root that was deleted while replies to it stay (PER-24, SPEC §6.5): its
   * author's `kind:5` came back. A stand-in with the deleted event's id, no
   * author and no body, dated by its first reply.
   */
  deleted?: true
  /** A root the read did not return, with nothing saying it was deleted (SPEC §6.5's "not returned", ONE-9): the same stand-in, "can't be shown". */
  unseen?: true
}

/** A stand-in for a root that is gone: deleted, or not returned. Nobody wrote it, so it has nothing to edit, delete, react to or resolve. */
export const isGone = (event: Pick<ConversationEvent, 'deleted' | 'unseen'>): boolean => !!(event.deleted || event.unseen)

/** What the shared fold says of one thread (`foldThreads`, SPEC §6.4–§6.5, ONE-9). */
export interface ThreadFold {
  state: RootState
  /** The thread's Folder: its comment's `h`, else its replies'. A resolve is written there (§6.4, C51). */
  folder?: string
  /** The resolve or reopen that counts (§6.4, C51), whoever's state it is; absent when none does. */
  resolution?: Resolution
}

/** Everything the view draws, after the three reads. */
export interface FileConversation {
  /** The roots, oldest first, in the order the file's comments arrived. */
  roots: ConversationEvent[]
  /** Direct replies per root, oldest first. A root with none is absent. */
  replies: Record<string, ConversationEvent[]>
  /**
   * What has been done to every root and reply — edits (with their attachment
   * fold), reactions, resolutions — keyed by lowercase id, and what the reads
   * could not reach (`@estiva-app/conversation`'s `decorationsOf`, CON-5).
   */
  decorations: Decorations
  /** Each root's thread as the shared fold reads it, by the root's id: its state, its Folder and the resolve that counts. */
  threads: Record<string, ThreadFold>
  /**
   * The cards an edit chose instead, by lowercase id — the latest edit carrying
   * an `embed` replaces the message's own set (§6.8, `foldEmbeds`). A message no
   * edit re-chose is absent, and so is the whole map on a copy saved before it.
   */
  editedEmbeds?: Record<string, Embed[]>
  /**
   * Only the newest comments, drawn while the rest are read (PEE-7): older ones are on their way, and the whole
   * conversation holds at least `messages` comments and replies — every comment, and the newest ones' replies.
   */
  earlier?: { messages: number }
}

/** An attachment the composer uploaded — what `UploadedFile` carries once the blob reached the relay. */
export interface OutgoingAttachment {
  name: string
  contentType: string
  size: number
  sha256?: string
  mediaUrl?: string
  thumbUrl?: string
  /** An image's size, kept when an edit re-lists a file it already had. */
  dim?: string
  /** A file the message already had: its `imeta` as read, listed again as it is. */
  imeta?: Imeta
}

/** {@link ConversationEvent.authorship}: an event's `actor` and `p` tags, absent when it has none. */
export const authorshipOf = (event: { tags: string[][] }): string[][] | undefined => {
  const tags = event.tags.filter((t) => t[0] === 'actor' || t[0] === 'p')
  return tags.length ? tags : undefined
}

const withTags = (comment: FileComment, event: SignedEvent | undefined, address: string): ConversationEvent => ({
  ...comment,
  files: event ? attachmentsOf(event) : [],
  references: event ? referencesOf(event, address) : [],
  urgent: event ? urgentOf(event) : [],
  parts: event ? partsAndAnchorOf(event) : [],
  embeds: event ? embedsOf(event) : [],
  ownFile: event ? ownFileOf(event) : undefined,
  authorship: event ? authorshipOf(event) : undefined,
})

/**
 * The blocks a message shows (`part`, SPEC §13.6.1) and, for a comment anchored
 * to the file it is on (§13.6), its anchor flagged `anchor` — drawn with the
 * same card (Miky, COM-2 kickoff). Only a `kind:1111` anchors, against its `A`;
 * `blockRunOf` refuses any other kind.
 *
 * The anchor is a run of blocks and the words its selection starts and ends
 * with (LEAF-7), so it keeps its `block` and `quote` tags as written, for
 * `resolveCommentAnchor` to read against the file as it is now; `block` is the
 * run's first, which is all a one-block anchor ever had.
 *
 * A reply copies its comment's place (SPEC §13.6) and draws no anchor of its
 * own: the thread's comment shows where it is, once.
 *
 * A `part` of the file the comment is on draws nothing: a link to another
 * block of the same page is its chip only, in every app (COMM-8, Miky
 * 2026-10-19), and a comment sent before that rule still carries one.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-comment-remembers-where-its-selection-starts-and-ends.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-on-a-page-keeps-its-threads-place.md
 */
export function partsAndAnchorOf(event: Pick<SignedEvent, 'kind' | 'tags'>): ConversationPart[] {
  const run = parentOf(event) === null ? blockRunOf(event) : undefined
  const about = event.tags.find((t) => t[0] === 'A')?.[1]
  const quote = event.tags.find((t) => t[0] === QUOTE_TAG)
  const anchor: ConversationPart[] =
    run && about ? [{ address: about, block: run[0], anchor: true, anchorTags: [blockRunTag(run), ...(quote ? [quote] : [])] }] : []
  return [...anchor, ...partsOf(event).filter((part) => part.address !== about)]
}

/** A block a message shows, or the run and words a comment is anchored to. */
export type ConversationPart = PartPointer & { anchor?: true; anchorTags?: string[][] }

/** The `imeta` attachments of an event, as {@link RelayAttachment}. Mirrors `convex/nostr/sync.ts`'s `attachmentsOf`. */
export function attachmentsOf(event: { tags: NostrTag[] }): RelayAttachment[] {
  return imetaOf(event).map(relayAttachmentOf)
}

/** One `imeta` as {@link RelayAttachment} — also what an edit's attachment fold (`EditFold.attachments`) is drawn with. */
export const relayAttachmentOf = (f: Imeta): RelayAttachment => ({
  name: f.filename ?? f.alt ?? 'attachment',
  contentType: f.m,
  size: f.size,
  sha256: f.x,
  mediaUrl: f.url,
  ...(f.thumb ? { thumbUrl: f.thumb } : {}),
  ...(f.dim ? { dim: f.dim } : {}),
  imeta: f,
})

/** The addresses a comment names besides the file it is on — `a` and NIP-22's `A`. */
function referencesOf(event: SignedEvent, address: string): string[] {
  const out = new Set<string>()
  for (const tag of event.tags) {
    if ((tag[0] === 'a' || tag[0] === 'A') && tag[1] && tag[1] !== address) out.add(tag[1])
  }
  return [...out]
}

/**
 * Whom a message names urgently: the keys of its `urgent` tags. The text holds
 * the same `nostr:npub…` for an urgent mention as for an ordinary one, so the
 * chip's tone can come only from here (CON-24). A tag for somebody the text
 * does not name draws nothing, since there is no chip to colour.
 */
export function urgentOf(event: Pick<SignedEvent, 'tags'>): string[] {
  return [...new Set(event.tags.filter((t) => t[0] === URGENT_TAG && t[1]).map((t) => t[1]))]
}

/**
 * The `imeta` tags for a comment's attachments — CON-12, the same rule as
 * `convex/nostr/outbox.ts`: only a file that reached the relay is named, since
 * an `imeta` pointing at no blob is refused with the whole event. A file the
 * message already had is listed from its `imeta` as read, so an edit keeps
 * every field another app wrote (blurhash, duration, fallback…).
 */
export function imetaTagsFor(files: readonly OutgoingAttachment[]): NostrTag[] {
  const out: NostrTag[] = []
  for (const f of files) {
    if (f.imeta) {
      out.push(imetaTag(f.imeta))
      continue
    }
    if (!f.sha256 || !f.mediaUrl) continue
    out.push(imetaTag({ url: f.mediaUrl, m: f.contentType, x: f.sha256, size: f.size, thumb: f.thumbUrl, dim: f.dim, filename: f.name }))
  }
  return out
}

/**
 * The whole conversation below the roots: replies, and what has been done to
 * every root and reply.
 *
 * The roots are re-fetched by id inside interop's `threadsOf` — their `kind`
 * and their tags are reported by no projection — and it hands back the events,
 * so this is where their attachments come from too, with no second read.
 * Throws `RelayReadError` on a refused read, like every read here: an
 * unreadable conversation is not an empty one.
 */
export function fileConversationAsViewer(
  container: FileContainer,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileConversation> {
  return fileConversationWith(container, rootIds, viewerQuery(relayUrl, token))
}

/** {@link fileConversationAsViewer} over any query: the relay's, or the conversation store's (OPT-3). */
async function fileConversationWith(container: FileContainer, rootIds: readonly string[], query: QueryFn): Promise<FileConversation> {
  const { threads, gone } = await threadsWithGoneRoots(container.address, rootIds, query)
  return folded([...threadsDrawn(container, rootIds, threads), ...gone.events], query, (event) => withTags(fileCommentOf(event), event, container.address), undefined, gone)
}

/**
 * How many of a file's newest comments its first open draws before the rest are read (PEE-7). On production a
 * 200-comment topic's replies, asked by `#e` over every comment, took the relay ~0.9 s; over the newest 30,
 * 0.2–0.5 s — and thirty fill the pane with room to scroll.
 */
export const FIRST_PAGE = 30

/**
 * A file's newest {@link FIRST_PAGE} comments, their replies and what was done to them: what its first open draws
 * while {@link conversationWith} reads the whole conversation (PEE-7), marked `earlier` because more is coming.
 * `rootIds` are oldest first. A reply whose comment was deleted waits for the whole read, which finds its stand-in.
 */
export async function firstPageWith(container: FileContainer, rootIds: readonly string[], query: QueryFn): Promise<FileConversation> {
  const newest = rootIds.slice(-FIRST_PAGE)
  const drawn = threadsDrawn(container, newest, await threadEventsWith(container.address, newest, query))
  const conversation = await folded(drawn, query, (event) => withTags(fileCommentOf(event), event, container.address))
  const messages = rootIds.length + Object.values(conversation.replies).reduce((n, list) => n + list.length, 0)
  return { ...conversation, earlier: { messages } }
}

/**
 * The roots `rootIds` names that the thread read reached, and the replies under them: the events the view folds. A
 * reply under a root this conversation does not draw (a mention of the file, say) is not one of its threads.
 */
function threadsDrawn(container: FileContainer, rootIds: readonly string[], threads: Threads): SignedEvent[] {
  const roots = rootIds
    .map((id) => threads.roots[id])
    .filter((root): root is SignedEvent => !!root)
    // A mention — from another file's conversation, or a topic message naming
    // this file — arrives by `#a` too, and is not a root here (SPEC §6.4).
    // Which kinds count is the owner's manifest, and the projection that
    // produced `rootIds` already kept only those (interop's `conversationsOf`);
    // a `kind:9` among them is one the owner declares, so both are allowed here
    // and this re-reads only the tags.
    .filter((root) => isCommentOn(root, container.address, DECLARABLE_COMMENT_KINDS))
  return [...roots, ...roots.flatMap((root) => threads.replies[root.id] ?? [])]
}

/**
 * The read-only panes' threads (PEE-40): {@link threadsAsViewer}'s answer, with
 * the replies whose comment was deleted set under it the way Peek's own view
 * sets them — `deleted` names each stand-in, `replies` holds what hangs from it.
 */
export async function fileThreadsAsViewer(
  address: string,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileThreads> {
  const { threads, gone } = await threadsWithGoneRoots(address, rootIds, viewerQuery(relayUrl, token))
  const replies: Record<string, FileComment[]> = {}
  for (const [rootId, list] of Object.entries(threads.replies)) replies[rootId] = list.map(fileCommentOf)
  // The gone comments, by the shared fold (§6.5): deleted by their author, or not returned.
  const deleted: NonNullable<FileThreads['deleted']> = []
  for (const thread of foldThreads(gone.events)) {
    if (thread.state === 'present' || thread.replies.length === 0) continue
    replies[thread.id] = thread.replies.map((reply) => fileCommentOf(reply.event))
    deleted.push({ id: thread.id, createdAt: thread.replies[0].event.created_at, ...(goneState(thread.state, gone.deletionsRead) === 'unseen' ? { unseen: true as const } : {}) })
  }
  return {
    roots: Object.fromEntries(Object.entries(threads.roots).map(([id, event]) => [id, fileCommentOf(event)])),
    replies,
    deleted,
  }
}

/** interop's thread read, and beside it the replies whose comment is gone and what says whether it was deleted — both file panes' read. */
async function threadsWithGoneRoots(address: string, rootIds: readonly string[], query: QueryFn): Promise<{ threads: Threads; gone: GoneRoots }> {
  const [threads, onFile] = await Promise.all([
    threadEventsWith(address, rootIds, query),
    // Only for replies whose comment was deleted: a refusal here costs those, not the conversation.
    commentsOnFile(address, query).catch(() => []),
  ])
  // What the relay still holds and this read reached. Not `rootIds`: a re-read
  // right after a delete still asks about the deleted root, and its replies,
  // which `#e` still returns, would hang from a root that is not drawn.
  const known = new Set(Object.keys(threads.roots))
  for (const [rootId, list] of Object.entries(threads.replies)) if (known.has(rootId)) for (const e of list) known.add(e.id)
  const nested = nestedRepliesOf(threads, onFile, address)
  // Filed in their thread, so not taken for the replies of a gone comment below.
  for (const list of Object.values(nested)) for (const event of list) known.add(event.id)
  const gone = await goneRootsOf(onFile, known, address, query).catch(() => NONE_GONE)
  const replies = { ...threads.replies }
  for (const [rootId, more] of Object.entries(nested)) replies[rootId] = [...(replies[rootId] ?? []), ...more].sort(byOrder)
  return { threads: { ...threads, replies }, gone }
}

/**
 * The replies to a reply in `onFile`, by the root of the thread they belong to (ONE-9).
 *
 * A NIP-22 reply names only its parent in its lowercase `e` (SPEC §6.4), so a reply to a reply never answers the
 * `#e` read on the roots. The file's `A` read already holds it, so it is filed here with no further read: a reply
 * whose parent is in a thread is in that thread, at any depth. Only from a root or reply the thread read returned,
 * so a root this conversation does not draw adds nothing, and only a reply whose thread's `A` is this file, as in
 * {@link goneRootsOf}.
 */
function nestedRepliesOf(threads: Threads, onFile: readonly SignedEvent[], address: string): Record<string, SignedEvent[]> {
  // Each drawn event's thread: a root is its own, a direct reply is the root interop filed it under.
  const threadOf = new Map<string, string>(Object.keys(threads.roots).map((id) => [id, id]))
  for (const [rootId, list] of Object.entries(threads.replies)) if (threadOf.has(rootId)) for (const e of list) threadOf.set(e.id, rootId)
  const nested: Record<string, SignedEvent[]> = {}
  let waiting = onFile.filter((event) => !threadOf.has(event.id) && anchorsOf(event).includes(address))
  // A child can come before its parent in the answer: file in rounds until one files nothing.
  for (let filed = true; filed && waiting.length > 0; ) {
    filed = false
    waiting = waiting.filter((event) => {
      if (threadOf.has(event.id)) return false
      const parent = parentOf(event)
      const rootId = parent === null ? undefined : threadOf.get(parent)
      if (rootId === undefined) return true
      threadOf.set(event.id, rootId)
      ;(nested[rootId] ??= []).push(event)
      filed = true
      return false
    })
  }
  return nested
}

/** A gone comment's state: the fold's, but never "missing" when the deletion read was refused (§6.5). */
const goneState = (state: RootState, deletionsRead: boolean): 'deleted' | 'unseen' => (state === 'missing' && deletionsRead ? 'unseen' : 'deleted')

/**
 * The replies under comments that are gone and the `kind:5`s read for them. `deletionsRead` false: that read was
 * refused, so "not returned" is unproven and a gone comment is drawn deleted, as before ONE-9, never "can't be shown".
 */
interface GoneRoots {
  events: SignedEvent[]
  deletionsRead: boolean
}
const NONE_GONE: GoneRoots = { events: [], deletionsRead: true }

/** How many of a file's comments the `#A` read asks for — Buzz's clamp per filter. */
const FILE_COMMENTS_LIMIT = 1_000

/** Every `kind:1111` whose NIP-22 root is the file — roots and replies alike. */
function commentsOnFile(address: string, query: QueryFn): Promise<SignedEvent[]> {
  return query([{ kinds: [KIND.COMMENT], '#A': [address], limit: FILE_COMMENTS_LIMIT }])
}

/**
 * The replies whose comment the thread read did not reach, and the `kind:5`s
 * that say whether it was deleted: the events the shared fold needs to draw
 * each such thread (PER-24, SPEC §6.5, ONE-9).
 *
 * Deleting a comment deletes that one event: NIP-09 lets an author delete only
 * their own, the relay deletes exactly what is named, and `ConfirmDelete` tells
 * the person deleting that the replies stay. They do — but the `#e` thread read
 * asks about the roots it knows, and the deleted one is no longer among them,
 * so they are found by NIP-22's `A` instead (the same answer at any `limit`
 * since PER-9). `foldThreads` files them under their thread's comment, a reply
 * to a reply too, and its author's `kind:5` makes that comment "deleted";
 * without one it "can't be shown".
 *
 * A comment is gone only when a read by its id returns nothing: one this
 * conversation did not ask about but the relay still holds is not, and its
 * replies are left out. Only a reply whose thread's `A` is this file counts,
 * so a reply filed about another page adds no thread to this one.
 */
async function goneRootsOf(onFile: readonly SignedEvent[], known: ReadonlySet<string>, address: string, query: QueryFn): Promise<GoneRoots> {
  // A reply is never a comment (SPEC §6.4); what places it on this file is its thread's `A`.
  const candidates = onFile.filter((event) => !known.has(event.id) && anchorsOf(event).includes(address))
  const { replies, missingRoots } = groupThreads(candidates)
  const ids = missingRoots.filter((id) => !known.has(id))
  if (ids.length === 0) return NONE_GONE

  // Apart, so a refused deletion read costs only the deleted-or-not answer, not the threads.
  const [found, deletions] = await Promise.all([
    query([{ ids, limit: ids.length }]),
    query([{ kinds: [KIND.DELETION], '#e': ids, limit: FILE_COMMENTS_LIMIT }]).catch(() => null),
  ])
  const asked = new Set(ids)
  const held = new Set(found.filter((e) => asked.has(e.id)).map((e) => e.id))
  const gone = ids.filter((id) => !held.has(id))
  return {
    events: [...gone.flatMap((id) => replies[id] ?? []), ...(deletions ?? []).filter((e) => e.kind === KIND.DELETION)],
    deletionsRead: deletions !== null,
  }
}

type FileContainer = Extract<ConversationContainer, { kind: 'file' }>

/** The comment kinds an owner can declare (§7.3 `emits.kind` and `alsoRead`) — what a projected root may be. */
const DECLARABLE_COMMENT_KINDS = [KIND.COMMENT, KIND.STREAM_MESSAGE]

/** The conversation in a container, read the way its kind is read. `rootIds` is a file's; a channel finds its own. */
export function conversationAsViewer(
  container: ConversationContainer,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileConversation> {
  return conversationWith(container, rootIds, viewerQuery(relayUrl, token))
}

/**
 * {@link conversationAsViewer} over any query (OPT-3). The relay's, recorded,
 * fills the conversation store; the store's own answers the same read again
 * from what it holds, so a catch-up folds with no further request.
 */
export function conversationWith(container: ConversationContainer, rootIds: readonly string[], query: QueryFn): Promise<FileConversation> {
  return container.kind === 'file' ? fileConversationWith(container, rootIds, query) : channelConversationWith(container.h, query, container.general)
}

/** Buzz clamps `limit` at 1,000 per filter; a page that comes back full is followed by the next. */
export const CHANNEL_PAGE = 1_000
/** How many pages one read will follow — 20,000 messages, far past the busiest DM. */
export const CHANNEL_PAGES = 20

/**
 * A channel's conversation — its messages, their replies, and what was done
 * to each (REM-1). See the module header for the fold.
 *
 * The whole channel, every time. A DM is read to the end rather than a window
 * because a window is exactly what the Convex projection had and what DMS-7's
 * duplicates broke: an older message with no row was an older message nobody
 * could see. Paged by `until` on the oldest `created_at` seen, inclusive, so a
 * second that straddles two pages is read twice and deduplicated by id rather
 * than skipped.
 */
export function channelConversationAsViewer(h: string, relayUrl: string, token: StoredToken): Promise<FileConversation> {
  return channelConversationWith(h, viewerQuery(relayUrl, token))
}

async function channelConversationWith(h: string, query: QueryFn, general = false): Promise<FileConversation> {
  const messages = new Map<string, SignedEvent>()
  // Every message a page held, the ones left out too: paging stops on a page that brought nothing new, not nothing kept.
  const seen = new Set<string>()
  let until: number | undefined
  // A team's chat is the channel's messages about no file: the same reading as its stream's (`channelStreams.ts`).
  const about = (event: SignedEvent) => event.tags.some((tag) => tag[0] === 'a' && !!tag[1])
  for (let page = 0; page < CHANNEL_PAGES; page += 1) {
    const filter = { kinds: [KIND.STREAM_MESSAGE], '#h': [h], limit: CHANNEL_PAGE, ...(until !== undefined ? { until } : {}) }
    const events = await query([filter])
    const before = seen.size
    for (const event of events) {
      if (event.kind !== KIND.STREAM_MESSAGE) continue
      seen.add(event.id)
      if (!general || !about(event)) messages.set(event.id, event)
    }
    if (events.length < CHANNEL_PAGE || seen.size === before) break
    until = Math.min(...events.map((e) => e.created_at))
  }

  const asEvent = (event: SignedEvent): ConversationEvent => ({
    id: event.id,
    author: event.pubkey,
    body: event.content,
    createdAt: event.created_at,
    kind: event.kind,
    files: attachmentsOf(event),
    references: referencesOf(event, ''),
    urgent: urgentOf(event),
    parts: partsAndAnchorOf(event),
    embeds: embedsOf(event),
    authorship: authorshipOf(event),
  })
  // A reply whose thread's root this channel does not hold is dropped rather
  // than stranded under a stand-in: a DM's messages are never deleted from under replies.
  return folded([...messages.values()], query, asEvent, (thread) => thread.state === 'present')
}

/**
 * A conversation's events read through the one shared fold (`foldThreads`, SPEC §6.4–§6.6, ONE-9): its threads in
 * order, every reply under its thread's comment (a reply to a reply too), whether a gone comment was deleted or
 * can't be shown, and the resolve that counts. `events` are its messages and the `kind:5`s read for a gone comment;
 * what was done to them is read here, a gone comment's resolutions among it. `keep` leaves a thread out.
 */
async function folded(
  events: readonly SignedEvent[],
  query: QueryFn,
  asEvent: (event: SignedEvent) => ConversationEvent,
  keep: (thread: Thread) => boolean = () => true,
  gone: Pick<GoneRoots, 'deletionsRead'> = NONE_GONE,
): Promise<FileConversation> {
  const messages = events.filter((event) => event.kind !== KIND.DELETION)
  const { replies: byRoot, missingRoots } = groupThreads(messages)
  // Each target's body goes with it, so "edited" means the body changed (SPEC §6.8). A gone comment is a target too,
  // for its thread's resolution (§6.5: still resolved when it was), dated by its first reply.
  const targets = [
    ...messages.map((e) => ({ id: e.id, at: e.created_at, body: e.content })),
    ...missingRoots.flatMap((id) => (byRoot[id]?.length ? [{ id, at: byRoot[id][0].created_at }] : [])),
  ]
  const { decorations, editedEmbeds, read } = await decorationsWith(targets, query)

  const roots: ConversationEvent[] = []
  const replies: Record<string, ConversationEvent[]> = {}
  const threads: Record<string, ThreadFold> = {}
  for (const thread of foldThreads([...events, ...read]).filter(keep)) {
    const root: ConversationEvent = thread.root
      ? asEvent(thread.root.event)
      : {
          id: thread.id,
          author: '',
          body: '',
          // Dated by its first reply: the nearest time the relay still holds.
          createdAt: thread.replies[0].event.created_at,
          kind: thread.replies[0].kind,
          files: [],
          references: [],
          urgent: [],
          ...(goneState(thread.state, gone.deletionsRead) === 'deleted' ? { deleted: true as const } : { unseen: true as const }),
        }
    roots.push(root)
    if (thread.replies.length) replies[root.id] = thread.replies.map((reply) => asEvent(reply.event))
    threads[root.id] = { state: thread.state, ...(thread.folder ? { folder: thread.folder } : {}), ...(thread.resolution ? { resolution: thread.resolution } : {}) }
  }
  return { roots, replies, decorations, editedEmbeds, threads }
}

/**
 * What has been done to every message: the third read (`decorationsOf`), and every event it brought, for the fold.
 * The edits it fetches carry the cards an edit re-chose too, so they are kept on the way past rather than asked for a
 * second time.
 */
async function decorationsWith(
  targets: readonly { id: string; at: number; body?: string }[],
  query: QueryFn,
): Promise<{ decorations: Decorations; editedEmbeds: Record<string, Embed[]>; read: SignedEvent[] }> {
  const read: SignedEvent[] = []
  const recording: QueryFn = async (filters) => {
    const answer = await query(filters)
    read.push(...answer)
    return answer
  }
  const decorations = await decorationsOf(targets, recording)
  const ids = new Set(targets.map((t) => t.id.toLowerCase()))
  const edits = read.filter((event) => event.kind === KIND_EDIT)
  const editedEmbeds = Object.fromEntries(Object.entries(foldEmbeds(edits)).filter(([id]) => ids.has(id)))
  return { decorations, editedEmbeds, read }
}

/**
 * A file's mentions as one conversation: each mention a root of its own, its replies under it, and what was done to
 * them (`fileMentions`). A mention may itself be a reply, so these are not folded into threads: each thread's
 * resolution is still the one §6.4 counts, in the Folder the mention was said in (`resolutionOf`).
 */
export async function decorate(
  roots: ConversationEvent[],
  replies: Record<string, ConversationEvent[]>,
  query: QueryFn,
  folderOf: (root: ConversationEvent) => string | undefined,
): Promise<FileConversation> {
  const targets = [...roots, ...Object.values(replies).flat()].map((e) => ({ id: e.id, at: e.createdAt, body: e.body }))
  const { decorations, editedEmbeds } = await decorationsWith(targets, query)
  const threads: Record<string, ThreadFold> = {}
  for (const root of roots) {
    const folder = folderOf(root)
    const resolution = resolutionOf(decorations.byId[root.id.toLowerCase()]?.resolutions ?? [], {
      folder,
      replies: (replies[root.id] ?? []).map((reply) => reply.id),
    })
    threads[root.id] = { state: 'present', ...(folder ? { folder } : {}), ...(resolution ? { resolution } : {}) }
  }
  return { roots, replies, decorations, editedEmbeds, threads }
}

/** What a write reports: the relay's answer, and the event's id when it took it. */
export type WriteResult = { ok: true; id: string } | { ok: false; reason: string }

const refused = (result: { ok: boolean; reason?: string; eventId?: string }, fallback: string): WriteResult =>
  result.ok && result.eventId ? { ok: true, id: result.eventId } : { ok: false, reason: result.reason ?? fallback }

/** Tries per write, the first included. */
export const PUBLISH_ATTEMPTS = 3
/** The wait before the second try; doubled before each one after. */
export const PUBLISH_BACKOFF_MS = 1_000

const sleepFor = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/**
 * How long to wait before trying again, or null when trying again cannot help.
 *
 * A quota refusal names its own wait (`retryAfterMs`). A failure that never
 * reached a verdict — the request threw, the answer was a 5xx or a 408 — is
 * worth another try after a backoff. Anything else is the relay's considered
 * answer about this event (a 4xx, `accepted:false`), and asking again returns
 * the same refusal. So is a busy relay's ({@link RELAY_BUSY_MESSAGE}): the
 * bridge has already asked it again quietly, and these tries on top of those
 * would ask a struggling relay twelve times for one write (APP-9).
 */
function retryWaitMs(result: PublishResult, threw: boolean, attempt: number): number | null {
  if (result.reason === RELAY_BUSY_MESSAGE) return null
  const quota = retryAfterMs(result.reason ?? '')
  if (quota !== null || result.httpStatus === 429) {
    const wait = quota ?? PUBLISH_BACKOFF_MS
    return wait > RATE_LIMIT_MAX_WAIT_MS ? null : wait
  }
  const status = result.httpStatus
  if (threw || (status !== undefined && (status >= 500 || status === 408))) return PUBLISH_BACKOFF_MS * 2 ** (attempt - 1)
  return null
}

/**
 * Sign once, then publish until the relay has said yes or has said no — REM-1,
 * and CON-7's third leg.
 *
 * The relay is the only store this conversation has, so a write that did not
 * land is a write that did not happen, and success is reported only on the
 * relay's acceptance. A transient failure is tried again rather than reported
 * (see {@link retryWaitMs}); the same signed event every time, so a try whose
 * answer was lost and that in fact landed comes back as the relay's
 * `duplicate:`, which is acceptance. When every try fails the caller hears it
 * and keeps what the person wrote.
 */
export async function publishConfirmed(
  unsigned: UnsignedEvent,
  relayUrl: string,
  token: StoredToken,
  fallback: string,
  { sleep = sleepFor }: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<WriteResult> {
  let signed: SignedEvent | undefined
  for (let attempt = 1; ; attempt += 1) {
    let result: PublishResult
    let threw = false
    try {
      signed ??= await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
      result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
    } catch (error) {
      threw = true
      result = { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    // The signed id is known before the relay answers; `eventId` is what the
    // bridge reports when it parsed one, and the two are the same event.
    if (result.ok && signed) return { ok: true, id: result.eventId ?? signed.id }
    const wait = attempt < PUBLISH_ATTEMPTS ? retryWaitMs(result, threw, attempt) : null
    if (wait === null) return refused(result, fallback)
    await sleep(wait)
  }
}

const publish = (unsigned: UnsignedEvent, relayUrl: string, token: StoredToken, fallback: string): Promise<WriteResult> =>
  publishConfirmed(unsigned, relayUrl, token, fallback)

/** What the composer sends: where, the body, and what it carries. */
export interface ComposeArgs {
  container: ConversationContainer
  body: string
  parent?: FileComment
  files?: readonly OutgoingAttachment[]
  /** The people the composer's urgent mentions name, by pubkey (SPEC §13.1, CON-17). */
  urgent?: readonly string[]
  /** The cards the author chose, one per value the body names (SPEC §13.6.2, OPT-17). */
  embeds?: readonly Embed[]
}

/**
 * A comment on the file, or a reply under one of its comments — the owner's
 * `comment` action with the composer's whole payload — built and not sent
 * (OPT-6). A channel's is a `kind:9`.
 *
 * A reply is the same event with NIP-22's lowercase trio redirected at the
 * parent — interop's `replyTo` (PRO-20) — and the attachments and mentions are
 * added to it, so a reply with a picture is one event and not two rules.
 *
 * Asks the relay nothing unless the body pastes an app URL, which is resolved
 * to the object it names.
 */
export async function composeCommentAsViewer(
  args: ComposeArgs,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true; event: UnsignedEvent } | { ok: false; reason: string }> {
  const { container } = args
  const own = container.kind === 'file' ? container.address : ''
  /*
    What the words name, by `nostr:` reference or by a pasted app link (FOL-38,
    CON-25, PEEKM-7): an `a` for an object, a `q` for an event, a `part` for a
    link to one block — the link reader's, as every app tags them. Asked before
    the event is built because a link's address needs the relay; a URL that
    names nothing, or sits in code, stays prose. Never the file it is said on
    (its `A`) nor the message a reply answers (its `e`).
  */
  const references = await linkTagsAsViewer(args.body, { file: own || undefined, parent: args.parent?.id }, relayUrl, token)
  const urgent = urgentTagsFor(args.body, args.urgent)
  // Beside the `a`/`q` each one's value has (SPEC §13.6.2): the composer sends only values its body names.
  const embeds = (args.embeds ?? []).map((embed) => embedTag(embed.value, embed.layout))

  /*
    A channel's message is a `kind:9` — `buildMessage`, as `convex/nostr/outbox.ts`
    built a DM's until REM-1: a reply is the same event with Buzz's single
    `reply`-marked `e`, since Peek's replies are always direct. Nothing is asked
    of any app's manifest, because a channel is not an object.
  */
  if (container.kind === 'channel') {
    const unsigned = buildMessage(token.pubkey, Date.now(), {
      channelUuid: container.h,
      content: args.body,
      ...(args.parent ? { threadRef: { rootId: args.parent.id, parentId: args.parent.id } } : {}),
      mentions: mentionTagsFor(args.body).map((tag) => tag[1]),
      mediaTags: imetaTagsFor(args.files ?? []),
    })
    unsigned.tags.push(...urgent, ...references, ...embeds)
    return { ok: true, event: unsigned }
  }

  // No `mentionTagsFor` here: since interop 0.53 the comment action names the mentioned people in `p` itself.
  const extra: NostrTag[] = [...imetaTagsFor(args.files ?? []), ...urgent, ...references, ...embeds]
  const parent = args.parent
  return buildCommentAsViewer(
    {
      naddr: container.address,
      folder: container.h,
      value: args.body,
      // A reply copies its comment's place (SPEC §13.6; why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reply-on-a-page-keeps-its-threads-place.md).
      ...(parent ? { replyTo: { id: parent.id, kind: parent.kind, author: parent.author, ...(parent.place ? { place: parent.place } : {}) } } : {}),
    },
    relayUrl,
    token,
    (event: UnsignedActionEvent): UnsignedActionEvent => ({ ...event, tags: [...event.tags, ...extra] }),
  )
}

/**
 * Comment on the file, or reply under one of its comments, and wait for the
 * relay: {@link composeCommentAsViewer}, then {@link publishConfirmed} — tried
 * again on a transient failure, a file's comment as much as a channel's
 * message.
 */
export async function commentAsViewer(
  args: ComposeArgs,
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  const built = await composeCommentAsViewer(args, relayUrl, token)
  if (!built.ok) return built
  const refusal = args.container.kind === 'channel' ? 'The relay refused the message.' : 'The relay refused the comment.'
  return publish(built.event, relayUrl, token, refusal)
}

/**
 * A Nostr event's id, from its bytes (NIP-01): the SHA-256 of
 * `[0, pubkey, created_at, kind, tags, content]`. Known before the event is
 * signed, so what is drawn while it is sent carries the id it will have
 * (OPT-6).
 */
export async function eventIdOf(event: UnsignedEvent): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Edit a comment or a reply — `kind:40003`, newest wins for every reader (CON-8).
 *
 * `files` is the message's whole attachment set after the edit, as `imeta`
 * (SPEC §6.8): the caller lists every file it keeps, changed or not, because an
 * edit is the whole new message and one with none takes them all off.
 */
export async function editCommentAsViewer(
  args: EditArgs,
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  return publish(await composeEdit(args, relayUrl, token), relayUrl, token, 'The relay refused the edit.')
}

export interface EditArgs {
  container: ConversationContainer
  targetEventId: string
  /** The message the edited one replies to, if it is a reply: its new words earn no `q` for it, as its send did not. */
  parentId?: string
  body: string
  /** The message's whole file set after the edit (§6.8), changed or not: an empty set takes every file off. */
  files: readonly OutgoingAttachment[]
  /**
   * The card set after the edit, when it changed (SPEC §13.6.2): `embed` folds
   * like `imeta`, so a set replaces the one before it — `none` for each card
   * taken away — and an edit carrying none leaves the cards as they were.
   */
  embeds?: readonly Embed[]
}

/*
  An edit, a deletion and a reaction, built and not sent (OPT-8), so each can
  be drawn under the id it will have before the relay answers — as a message
  is ({@link composeCommentAsViewer}). Only an edit asks the relay anything:
  what an app link in its new words names.
*/

/**
 * The `kind:40003` {@link editCommentAsViewer} sends. It carries the `a` and
 * `q` its new words earn, as a send's would, so the file a link added by the
 * edit names lists the message under Mentioned in, and one it took out stops
 * (PEEKM-7). No `part`, and never a person: `p` and `urgent` stay as sent.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/an-edit-says-what-the-message-links-now.md
 */
export async function composeEdit(
  args: EditArgs,
  relayUrl: string,
  token: StoredToken,
  /**
   * `waitMs: 0` builds it from the link answers already in hand, as it is
   * drawn the moment Save is pressed (OPT-8); the same `at` gives the signed
   * one the same id when the wait named nothing more.
   */
  options: { at?: number; waitMs?: number } = {},
): Promise<UnsignedEvent> {
  const own = { file: args.container.kind === 'file' ? args.container.address : undefined, parent: args.parentId }
  const links = await linkTagsAsViewer(args.body, own, relayUrl, token, { edit: true, waitMs: options.waitMs })
  const unsigned = buildEdit(token.pubkey, options.at ?? Date.now(), {
    channelUuid: args.container.h,
    targetEventId: args.targetEventId,
    body: args.body,
    // The whole folded set when it changed: a set replaces (§13.6.2).
    embeds: args.embeds,
  })
  unsigned.tags.push(...imetaTagsFor(args.files), ...links)
  return unsigned
}

/** The `kind:5` {@link deleteEventAsViewer} sends. */
export const composeDeletion = (targetEventId: string, pubkey: string): UnsignedEvent =>
  buildDeletion(pubkey, Date.now(), { targetEventId })

/** What a reaction needs of the message it is on: its id, its signer and the tags that can make it someone else's. */
export type ReactionTarget = Pick<ConversationEvent, 'id' | 'author' | 'authorship'>

/**
 * The `kind:7` {@link reactAsViewer} sends: its `p` names whose message it is on, so anyone can find the reactions
 * to their own messages (ACT-6). The relay's key is read — once a session — only for a message carrying an `actor`
 * or a `p`, the only kind the relay can have signed for someone else; reacting to any other costs no read. With no
 * key (none readable, or the read failed) it names the signer.
 *
 * `readKey: false` reads nothing and names the signer: the reaction drawn at once while the key is read. With the
 * same `at`, it is the very event the read builds for every message the relay did not sign for someone.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-names-whose-message-it-reacts-to.md
 */
export async function composeReaction(
  args: { target: ReactionTarget; emoji: string },
  relayUrl: string,
  token: StoredToken,
  options: { at?: number; readKey?: boolean } = {},
): Promise<UnsignedEvent> {
  const target = { id: args.target.id, pubkey: args.target.author, tags: args.target.authorship ?? [] }
  /*
    A key that could not be read does not stop the reaction: it names the signer then, which is right for every
    message a person signed. The failed read is not kept, so the next reaction asks again.
  */
  const relayKey =
    options.readKey !== false && needsRelayKey(target)
      ? await relaySigningKeyOnce(relayUrl, token).catch((error: unknown) => {
          console.warn('[nostr] reading the relay’s key failed; the reaction names the message’s signer:', error)
          return null
        })
      : null
  return buildReaction(token.pubkey, options.at ?? Date.now(), { target, emoji: args.emoji, relayKey })
}

/**
 * Ask the relay to delete an event — a comment, a reply, or a reaction.
 *
 * Offered to everyone and refused by the relay where it must be (CON-3): the
 * effective author and an agent's owner are decided server-side, and a client
 * that hid the control for a non-author would hide it from the one person the
 * relay would have let through.
 */
export async function deleteEventAsViewer(targetEventId: string, relayUrl: string, token: StoredToken): Promise<WriteResult> {
  return publish(composeDeletion(targetEventId, token.pubkey), relayUrl, token, 'The relay refused the deletion.')
}

/** React to a comment — `kind:7`. Taking it back is {@link deleteEventAsViewer} on the reaction. */
export async function reactAsViewer(
  args: { target: ReactionTarget; emoji: string },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  return publish(await composeReaction(args, relayUrl, token), relayUrl, token, 'The relay refused the reaction.')
}

/** Resolve or reopen a comment — `kind:9101` at the message (PEEK-128, DMS-11). */
export async function resolveAsViewer(
  args: {
    container: ConversationContainer
    targetEventId: string
    action: ResolutionAction
    message?: string
    /** The reply that carried the resolution, when it was written in the thread. */
    supportingEventId?: string
    /** The comment's `h`, as read (`ThreadFold.folder`). Absent, the container's: a comment not read yet is one just written there. */
    folder?: string
  },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  const unsigned = buildResolution(token.pubkey, Date.now(), {
    // The comment's own Folder (§6.4, C51): only a resolve filed in its thread's Folder counts.
    channelUuid: args.folder ?? args.container.h,
    targetEventId: args.targetEventId,
    action: args.action,
    ...(args.message ? { rationale: args.message } : {}),
    ...(args.supportingEventId ? { supportingEventId: args.supportingEventId } : {}),
  })
  return publish(unsigned, relayUrl, token, 'The relay refused the resolution.')
}

export type { FileComment, FileThreads }
