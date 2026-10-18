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
  embedTag,
  embedsOf,
  imetaOf,
  imetaTag,
  KIND,
  blockRunOf,
  blockRunTag,
  partsOf,
  QUOTE_TAG,
  type Embed,
  type Imeta,
  type NostrTag,
  type PartPointer,
  type PublishResult,
  type ResolutionAction,
  type SignedEvent,
  type UnsignedEvent,
} from '@estiva-app/protocol'
import { anchorsOf, decorationsOf, foldEmbeds, groupThreads, isCommentOn, KIND_EDIT, mentionTagsFor, parentOf, quoteTagsFor, referenceTagsFor, URGENT_TAG, urgentTagsFor, type Decorations } from '@estiva-app/conversation'
import type { QueryFn, Threads } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import type { UnsignedActionEvent } from '@estiva-app/interop'
import { publishSigned, signViaEstivaId } from './bridge'
import { RATE_LIMIT_MAX_WAIT_MS, retryAfterMs } from './relayRead'
import { buildCommentAsViewer, fileCommentOf, threadEventsWith, urlReferenceTagsAsViewer, viewerQuery, type FileComment, type FileThreads } from './foreign'
import { findUrls } from '@/lib/textParsing'

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
  /**
   * A root that was deleted while replies to it stay (PER-24): a stand-in with
   * the deleted event's id, no author and no body, dated by its first reply.
   */
  deleted?: true
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
}

const withTags = (comment: FileComment, event: SignedEvent | undefined, address: string): ConversationEvent => ({
  ...comment,
  files: event ? attachmentsOf(event) : [],
  references: event ? referencesOf(event, address) : [],
  urgent: event ? urgentOf(event) : [],
  parts: event ? partsAndAnchorOf(event) : [],
  embeds: event ? embedsOf(event) : [],
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
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-comment-remembers-where-its-selection-starts-and-ends.md
 */
export function partsAndAnchorOf(event: Pick<SignedEvent, 'kind' | 'tags'>): ConversationPart[] {
  const run = blockRunOf(event)
  const about = event.tags.find((t) => t[0] === 'A')?.[1]
  const quote = event.tags.find((t) => t[0] === QUOTE_TAG)
  const anchor: ConversationPart[] =
    run && about ? [{ address: about, block: run[0], anchor: true, anchorTags: [blockRunTag(run), ...(quote ? [quote] : [])] }] : []
  return [...anchor, ...partsOf(event)]
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
 * an `imeta` pointing at no blob is refused with the whole event.
 */
export function imetaTagsFor(files: readonly OutgoingAttachment[]): NostrTag[] {
  const out: NostrTag[] = []
  for (const f of files) {
    if (!f.sha256 || !f.mediaUrl) continue
    out.push(imetaTag({ url: f.mediaUrl, m: f.contentType, x: f.sha256, size: f.size, thumb: f.thumbUrl, filename: f.name }))
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
  const { threads, orphaned } = await threadsWithDeletedRoots(container.address, rootIds, query)
  const conversationEvent = (event: SignedEvent) => withTags(fileCommentOf(event), event, container.address)
  const { roots, replies } = threadsDrawn(container, rootIds, threads)
  for (const [rootId, list] of Object.entries(orphaned.replies)) replies[rootId] = list.map(conversationEvent)
  // Oldest first. A stand-in is dated by its first reply — the nearest time the relay still holds.
  const allRoots = orphaned.roots.length ? [...roots, ...orphaned.roots].sort((a, b) => a.createdAt - b.createdAt) : roots

  return decorate(allRoots, replies, query)
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
  const { roots, replies } = threadsDrawn(container, newest, await threadEventsWith(container.address, newest, query))
  const messages = rootIds.length + Object.values(replies).reduce((n, list) => n + list.length, 0)
  return { ...(await decorate(roots, replies, query)), earlier: { messages } }
}

/** The roots `rootIds` names that the thread read reached, and their replies, as the view draws them. */
function threadsDrawn(
  container: FileContainer,
  rootIds: readonly string[],
  threads: Threads,
): { roots: ConversationEvent[]; replies: Record<string, ConversationEvent[]> } {
  const conversationEvent = (event: SignedEvent) => withTags(fileCommentOf(event), event, container.address)
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
    .map(conversationEvent)
  const replies: Record<string, ConversationEvent[]> = {}
  for (const [rootId, list] of Object.entries(threads.replies)) {
    replies[rootId] = list.map(conversationEvent)
  }
  return { roots, replies }
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
  const { threads, orphaned } = await threadsWithDeletedRoots(address, rootIds, viewerQuery(relayUrl, token))
  const replies: Record<string, FileComment[]> = {}
  for (const [rootId, list] of [...Object.entries(threads.replies), ...Object.entries(orphaned.replies)]) replies[rootId] = list.map(fileCommentOf)
  return {
    roots: Object.fromEntries(Object.entries(threads.roots).map(([id, event]) => [id, fileCommentOf(event)])),
    replies,
    deleted: orphaned.roots.map(({ id, createdAt }) => ({ id, createdAt })),
  }
}

/** interop's thread read, and beside it the replies whose comment was deleted — both file panes' read. */
async function threadsWithDeletedRoots(
  address: string,
  rootIds: readonly string[],
  query: QueryFn,
): Promise<{ threads: Threads; orphaned: Awaited<ReturnType<typeof deletedRootsOf>> }> {
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
  const orphaned = await deletedRootsOf(onFile, known, address, query).catch(() => ({ roots: [], replies: {} }))
  return { threads, orphaned }
}

/** How many of a file's comments the `#A` read asks for — Buzz's clamp per filter. */
const FILE_COMMENTS_LIMIT = 1_000

/** Every `kind:1111` whose NIP-22 root is the file — roots and replies alike. */
function commentsOnFile(address: string, query: QueryFn): Promise<SignedEvent[]> {
  return query([{ kinds: [KIND.COMMENT], '#A': [address], limit: FILE_COMMENTS_LIMIT }])
}

/**
 * The replies whose comment was deleted, each set under a stand-in for it (PER-24).
 *
 * Deleting a comment deletes that one event: NIP-09 lets an author delete only
 * their own, the relay deletes exactly what is named, and `ConfirmDelete` tells
 * the person deleting that the replies stay. They do — but the `#e` thread read
 * asks about the roots it knows, and the deleted one is no longer among them,
 * so they are found by NIP-22's `A` instead (the same answer at any `limit`
 * since PER-9) and drawn under a deleted root, as Buzz draws a thread whose
 * first message was deleted.
 *
 * A parent counts as deleted only when a read by its id returns nothing: a
 * parent this conversation did not ask about but the relay still holds is not
 * a deleted one, and a reply to a reply here is left where it was.
 */
async function deletedRootsOf(
  onFile: readonly SignedEvent[],
  known: ReadonlySet<string>,
  address: string,
  query: QueryFn,
): Promise<{ roots: ConversationEvent[]; replies: Record<string, SignedEvent[]> }> {
  const byParent = new Map<string, SignedEvent[]>()
  for (const event of onFile) {
    // A reply is never a comment (SPEC §6.4); what places it on this file is its thread's `A`.
    if (known.has(event.id) || !anchorsOf(event).includes(address)) continue
    const parent = parentOf(event)
    if (!parent || known.has(parent)) continue
    byParent.set(parent, [...(byParent.get(parent) ?? []), event])
  }
  if (byParent.size === 0) return { roots: [], replies: {} }

  const ids = [...byParent.keys()]
  const held = new Set((await query([{ ids, limit: ids.length }])).map((e) => e.id))

  const roots: ConversationEvent[] = []
  const replies: Record<string, SignedEvent[]> = {}
  for (const [parent, list] of byParent) {
    if (held.has(parent)) continue
    const thread = [...list].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1))
    replies[parent] = thread
    roots.push({ id: parent, author: '', body: '', createdAt: thread[0].created_at, kind: KIND.COMMENT, files: [], references: [], urgent: [], deleted: true })
  }
  return { roots, replies }
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
  return container.kind === 'file' ? fileConversationWith(container, rootIds, query) : channelConversationWith(container.h, query)
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

async function channelConversationWith(h: string, query: QueryFn): Promise<FileConversation> {
  const messages = new Map<string, SignedEvent>()
  let until: number | undefined
  for (let page = 0; page < CHANNEL_PAGES; page += 1) {
    const filter = { kinds: [KIND.STREAM_MESSAGE], '#h': [h], limit: CHANNEL_PAGE, ...(until !== undefined ? { until } : {}) }
    const events = await query([filter])
    const before = messages.size
    for (const event of events) if (event.kind === KIND.STREAM_MESSAGE) messages.set(event.id, event)
    if (events.length < CHANNEL_PAGE || messages.size === before) break
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
  })
  const threaded = groupThreads([...messages.values()])
  const roots = threaded.roots.map(asEvent)
  const replies: Record<string, ConversationEvent[]> = {}
  // A reply whose thread's root this channel does not hold is dropped rather
  // than stranded under a stand-in: a DM's messages are never deleted from under replies.
  for (const root of threaded.roots) {
    const list = threaded.replies[root.id]
    if (list) replies[root.id] = list.map(asEvent)
  }
  return decorate(roots, replies, query)
}

/** What has been done to every root and reply: the third read, whichever container they came from — or none, for a file's mentions. */
export async function decorate(roots: ConversationEvent[], replies: Record<string, ConversationEvent[]>, query: QueryFn): Promise<FileConversation> {
  // A deleted root's stand-in has nothing done to it that anyone can see.
  // Each target's body goes with it, so "edited" means the body changed (SPEC §6.8).
  const targets = [...roots.filter((r) => !r.deleted), ...Object.values(replies).flat()].map((e) => ({ id: e.id, at: e.createdAt, body: e.body }))
  // The edits that read fetches carry the cards an edit re-chose too, so they are
  // kept on the way past rather than asked for a second time.
  const edits: SignedEvent[] = []
  const recording: QueryFn = async (filters) => {
    const answer = await query(filters)
    for (const event of answer) if (event.kind === KIND_EDIT) edits.push(event)
    return answer
  }
  const decorations = await decorationsOf(targets, recording)
  const ids = new Set(targets.map((t) => t.id.toLowerCase()))
  const editedEmbeds = Object.fromEntries(Object.entries(foldEmbeds(edits)).filter(([id]) => ids.has(id)))
  return { roots, replies, decorations, editedEmbeds }
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
 * the same refusal.
 */
function retryWaitMs(result: PublishResult, threw: boolean, attempt: number): number | null {
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
    A pasted app URL is indexed like a `nostr:naddr…` (FOL-38): an `a` for an
    object, a `q` for an event. Resolved before the event is built because the
    address needs the relay; a URL that names nothing stays prose. The two
    sources can name one object twice — a pointer and its link in the same
    sentence — so the union is by tag, not by source. A `nostr:nevent…` the
    body names — a `[` pick — earns its `q` the same way (CON-25, SPEC §13.1),
    except the message a reply answers, which is its `e`.
  */
  const fromUrls = await urlReferenceTagsAsViewer(findUrls(args.body), own, relayUrl, token)
  const seen = new Set<string>()
  const references = [...referenceTagsFor(args.body, own), ...quoteTagsFor(args.body, args.parent?.id), ...fromUrls].filter((tag) => {
    const key = `${tag[0]}:${tag[1]}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
      ...(parent ? { replyTo: { id: parent.id, kind: parent.kind, author: parent.author } } : {}),
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
 * `files`, when given, is the attachment set after the edit, as `imeta` — RFC
 * 0.4 §7.2.1 as amended 2026-09-23 (CON-5), which `@estiva-app/conversation`'s `foldEdits` reads. A
 * set replaces the one before it, and an edit carrying none leaves the
 * attachments as they were, so an empty set cannot be said: the caller refuses
 * it before it gets here.
 */
export async function editCommentAsViewer(
  args: EditArgs,
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  return publish(composeEdit(args, token.pubkey), relayUrl, token, 'The relay refused the edit.')
}

export interface EditArgs {
  container: ConversationContainer
  targetEventId: string
  body: string
  files?: readonly OutgoingAttachment[]
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
  is ({@link composeCommentAsViewer}). None of them asks the relay anything.
*/

/** The `kind:40003` {@link editCommentAsViewer} sends. */
export function composeEdit(args: EditArgs, pubkey: string): UnsignedEvent {
  const unsigned = buildEdit(pubkey, Date.now(), {
    channelUuid: args.container.h,
    targetEventId: args.targetEventId,
    body: args.body,
    // The whole folded set when it changed: a set replaces (§13.6.2).
    embeds: args.embeds,
  })
  if (args.files) unsigned.tags.push(...imetaTagsFor(args.files))
  return unsigned
}

/** The `kind:5` {@link deleteEventAsViewer} sends. */
export const composeDeletion = (targetEventId: string, pubkey: string): UnsignedEvent =>
  buildDeletion(pubkey, Date.now(), { targetEventId })

/** The `kind:7` {@link reactAsViewer} sends. */
export const composeReaction = (args: { targetEventId: string; emoji: string }, pubkey: string): UnsignedEvent =>
  buildReaction(pubkey, Date.now(), args)

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
  args: { targetEventId: string; emoji: string },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  return publish(composeReaction(args, token.pubkey), relayUrl, token, 'The relay refused the reaction.')
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
  },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  const unsigned = buildResolution(token.pubkey, Date.now(), {
    channelUuid: args.container.h,
    targetEventId: args.targetEventId,
    action: args.action,
    ...(args.message ? { rationale: args.message } : {}),
    ...(args.supportingEventId ? { supportingEventId: args.supportingEventId } : {}),
  })
  return publish(unsigned, relayUrl, token, 'The relay refused the resolution.')
}

export type { FileComment, FileThreads }
