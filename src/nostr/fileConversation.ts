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
 * The fold is the one Convex's `nostr/sync.ts` drew a DM with until REM-1: a
 * `kind:9` with an `e` is a reply to the
 * message that `e` names ({@link replyTargetOf}), one without is a message, and
 * a reply to something that is not a message here is dropped rather than
 * guessed at. Edits, reactions and resolutions are the same `#e` read a file's
 * comments get. A deleted message is simply not returned.
 *
 * ## Reads
 *
 * The roots come with the file (`resolveForeignObject`, `#a`-scoped); a reply
 * carries no `a`, so the thread read asks by `#e` ({@link threadsAsViewer});
 * and what has been done to any of them — an edit, a reaction, a resolution —
 * names the comment rather than the file, so it is a third read by `#e`
 * (`commentDecorationsOf`, interop 0.24.0). Three round trips, each for a
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
  decodeNaddr,
  decodeNpub,
  findNaddrs,
  findNostrUris,
  imetaOf,
  pointerToAddress,
  imetaTag,
  KIND,
  type NostrTag,
  type PublishResult,
  type ResolutionAction,
  type SignedEvent,
  type UnsignedEvent,
} from '@estiva-app/protocol'
import { commentDecorationsOf, editTargetOf, type CommentDecorations } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import type { UnsignedActionEvent } from '@estiva-app/interop'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { RATE_LIMIT_MAX_WAIT_MS, RelayReadError, retryAfterMs } from './relayRead'
import { applyActionAsViewer, threadsAsViewer, urlReferenceTagsAsViewer, type ActResult, type FileComment, type FileThreads } from './foreign'
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
}

/** Everything the view draws, after the three reads. */
export interface FileConversation {
  /** The roots, oldest first, in the order the file's comments arrived. */
  roots: ConversationEvent[]
  /** Direct replies per root, oldest first. A root with none is absent. */
  replies: Record<string, ConversationEvent[]>
  decorations: CommentDecorations
  /** Each edited root's or reply's edits, folded ({@link foldEdits}). A comment never edited is absent. */
  edits: Record<string, EditFold>
}

/**
 * A comment's `kind:40003`s, folded — RFC 0.4 §7.2.1 as amended 2026-09-23
 * (CON-5). The body and the attachments fold separately, in the same order.
 */
export interface EditFold {
  /** The body to show: the latest edit's content. */
  body: string
  /**
   * When the body last changed, epoch seconds. An edit whose content is
   * byte-identical to the body it replaces changes attachments only and is not
   * an edit of the body, so it does not move this; absent when no edit did.
   */
  editedAt?: number
  /**
   * The `imeta` set of the latest edit that carries at least one. A set
   * replaces, it does not append. Absent when no edit carries one — the
   * comment's own attachments stand, since an edit with no `imeta` means
   * "unchanged", never "none".
   */
  files?: RelayAttachment[]
}

/** An edit's order: `ts` when it agrees with `created_at` to the second, then `created_at`, then id (SPEC §6.3). */
function editOrderMs(event: SignedEvent): number {
  const raw = Number.parseInt(event.tags.find((t) => t[0] === 'ts')?.[1] ?? '', 10)
  if (Number.isFinite(raw) && Math.abs(Math.floor(raw / 1000) - event.created_at) <= 1) return raw
  return event.created_at * 1000
}

const byEditOrder = (a: SignedEvent, b: SignedEvent) => editOrderMs(a) - editOrderMs(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Fold every `kind:40003` onto the comment it targets.
 *
 * The target is interop's `editTargetOf` — the first `e` whose value is 64 hex,
 * marker ignored, which is the event whose ownership the relay checked (SPEC
 * §6.8, PEE-38). An edit whose target is not one of `targets` applies nowhere,
 * never to another `e` it carries. Edits are replayed oldest first
 * from the comment's own body, so "byte-identical to the body it replaces" is
 * judged against the body as it stood, not the original.
 */
export function foldEdits(targets: readonly { id: string; body: string }[], events: readonly SignedEvent[]): Record<string, EditFold> {
  const bodies = new Map(targets.map((t) => [t.id, t.body]))
  const byTarget = new Map<string, SignedEvent[]>()
  const seen = new Set<string>()
  for (const event of events) {
    if (event.kind !== KIND.MESSAGE_EDIT || seen.has(event.id)) continue
    seen.add(event.id)
    const target = editTargetOf(event)
    if (!target || !bodies.has(target)) continue
    byTarget.set(target, [...(byTarget.get(target) ?? []), event])
  }
  const out: Record<string, EditFold> = {}
  for (const [target, edits] of byTarget) {
    let body = bodies.get(target)!
    let editedAt: number | undefined
    let files: RelayAttachment[] | undefined
    for (const edit of [...edits].sort(byEditOrder)) {
      if (edit.content !== body) editedAt = edit.created_at
      body = edit.content
      const attached = attachmentsOf(edit)
      if (attached.length > 0) files = attached
    }
    out[target] = { body, ...(editedAt !== undefined ? { editedAt } : {}), ...(files ? { files } : {}) }
  }
  return out
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
})

/** The `imeta` attachments of an event, as {@link RelayAttachment}. Mirrors `convex/nostr/sync.ts`'s `attachmentsOf`. */
export function attachmentsOf(event: { tags: NostrTag[] }): RelayAttachment[] {
  return imetaOf(event).map((f) => ({
    name: f.filename ?? f.alt ?? 'attachment',
    contentType: f.m,
    size: f.size,
    sha256: f.x,
    mediaUrl: f.url,
    ...(f.thumb ? { thumbUrl: f.thumb } : {}),
    ...(f.dim ? { dim: f.dim } : {}),
  }))
}

/** The addresses a comment names besides the file it is on — `a` and NIP-22's `A`. */
function referencesOf(event: SignedEvent, address: string): string[] {
  const out = new Set<string>()
  for (const tag of event.tags) {
    if ((tag[0] === 'a' || tag[0] === 'A') && tag[1] && tag[1] !== address) out.add(tag[1])
  }
  return [...out]
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

/** The people a body mentions by `nostr:npub…`, as `p` tags — what `buildMessage` does for a `kind:9`. */
export function mentionTagsFor(body: string): NostrTag[] {
  const pubkeys = new Set<string>()
  for (const uri of findNostrUris(body)) {
    if (!/^nostr:npub1/i.test(uri)) continue
    try {
      pubkeys.add(decodeNpub(uri))
    } catch {
      // A malformed key is prose.
    }
  }
  return [...pubkeys].slice(0, 50).map((p) => ['p', p])
}

/**
 * The files a body names by `nostr:naddr…`, as `a` tags — the mention half of
 * Activity (CON-11). Mirrors `convex/nostr/refs.ts`'s `referencedAddresses`,
 * which is what a `kind:9` gets: the body is the source and the tag is the
 * index, so one `#a` filter answers "who named this file" without reading
 * every conversation the viewer can see (`fileMentions.ts`).
 *
 * The file the comment is on is left out. A root already carries it as `a`
 * and `A`, and on a reply NIP-22's lowercase `a` would name the parent — a
 * second copy would say the reply is a root.
 */
export function referenceTagsFor(body: string, own: string): NostrTag[] {
  const addresses = namedInBody(body)
  addresses.delete(own)
  return [...addresses].map((a) => ['a', a])
}

/** The addresses a body names by `nostr:naddr…`; a pointer that will not decode is prose. */
export function namedInBody(body: string): Set<string> {
  const addresses = new Set<string>()
  for (const naddr of findNaddrs(body)) {
    try {
      addresses.add(pointerToAddress(decodeNaddr(naddr)))
    } catch {
      // A malformed pointer is prose.
    }
  }
  return addresses
}

/**
 * Is this root a comment on the file, rather than a message elsewhere that
 * merely names it? Both arrive by the object's `#a` read, and drawn as one
 * list a mention would look as if somebody had said it here. SPEC §6.4 says
 * which tag carries which strength, per kind (CON-13, CON-14):
 *
 * - A `kind:1111`'s `A` is the comment — NIP-22's root object. A root whose
 *   `A` is another file is that file's conversation and this file's Activity
 *   (`fileMentions.ts`); its `a` for this file is the index of a reference
 *   (`referenceTagsFor`). A root with no `A` at all is malformed and read as
 *   a comment, the way §6.4 says to read it rather than drop the thread.
 * - A `kind:9` has no `A`, so its `a` is read against its body. One the body
 *   also names is the index of that reference — what Peek writes for every
 *   `[`-menu reference in a topic message (RIC-11) — and a mention. One the
 *   body does not name is the anchor of a comment written before REW-10
 *   moved comments to `1111`, which nothing writes any more and which is not
 *   replaceable, so it is read as a comment for good.
 */
export function isCommentOn(event: Pick<SignedEvent, 'kind' | 'content' | 'tags'>, address: string): boolean {
  if (event.kind === KIND.STREAM_MESSAGE) {
    const anchored = event.tags.some((tag) => tag[0] === 'a' && tag[1] === address)
    return anchored && !namedInBody(event.content).has(address)
  }
  const root = event.tags.find((tag) => tag[0] === 'A')?.[1]
  return !root || root === address
}

/**
 * The whole conversation below the roots: replies, and what has been done to
 * every root and reply.
 *
 * The roots are re-fetched by id inside {@link threadsAsViewer} — their `kind`
 * and their tags are reported by no projection — so this is where their
 * attachments come from too. Throws `RelayReadError` on a refused read, like
 * every read here: an unreadable conversation is not an empty one.
 */
export async function fileConversationAsViewer(
  container: FileContainer,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileConversation> {
  const threads = await threadsAsViewer(container.address, rootIds, relayUrl, token)
  const ids = new Set([...Object.keys(threads.roots), ...Object.values(threads.replies).flat().map((r) => r.id)])
  const raw = await eventsById([...ids], relayUrl, token)

  const roots = rootIds
    .map((id) => threads.roots[id])
    .filter((root): root is FileComment => !!root)
    // A mention — from another file's conversation, or a topic message naming
    // this file — arrives by `#a` too, and is not a root here.
    .filter((root) => {
      const event = raw.get(root.id)
      return !event || isCommentOn(event, container.address)
    })
    .map((root) => withTags(root, raw.get(root.id), container.address))
  const replies: Record<string, ConversationEvent[]> = {}
  for (const [rootId, list] of Object.entries(threads.replies)) {
    replies[rootId] = list.map((reply) => withTags(reply, raw.get(reply.id), container.address))
  }

  return decorate(roots, replies, relayUrl, token)
}

type FileContainer = Extract<ConversationContainer, { kind: 'file' }>

/** The conversation in a container, read the way its kind is read. `rootIds` is a file's; a channel finds its own. */
export function conversationAsViewer(
  container: ConversationContainer,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileConversation> {
  return container.kind === 'file'
    ? fileConversationAsViewer(container, rootIds, relayUrl, token)
    : channelConversationAsViewer(container.h, relayUrl, token)
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
export async function channelConversationAsViewer(h: string, relayUrl: string, token: StoredToken): Promise<FileConversation> {
  const messages = new Map<string, SignedEvent>()
  let until: number | undefined
  for (let page = 0; page < CHANNEL_PAGES; page += 1) {
    const filter = { kinds: [KIND.STREAM_MESSAGE], '#h': [h], limit: CHANNEL_PAGE, ...(until !== undefined ? { until } : {}) }
    const result = await queryRelay(relayUrl, [filter], token.accessToken, token.pubkey)
    if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
    const before = messages.size
    for (const event of result.events) if (event.kind === KIND.STREAM_MESSAGE) messages.set(event.id, event)
    if (result.events.length < CHANNEL_PAGE || messages.size === before) break
    until = Math.min(...result.events.map((e) => e.created_at))
  }

  const asEvent = (event: SignedEvent): ConversationEvent => ({
    id: event.id,
    author: event.pubkey,
    body: event.content,
    createdAt: event.created_at,
    kind: event.kind,
    files: attachmentsOf(event),
    references: referencesOf(event, ''),
  })
  const oldestFirst = (a: SignedEvent, b: SignedEvent) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1)
  const sorted = [...messages.values()].sort(oldestFirst)
  const roots = sorted.filter((e) => !replyTargetOf(e)).map(asEvent)
  const rootIds = new Set(roots.map((r) => r.id))
  const replies: Record<string, ConversationEvent[]> = {}
  for (const event of sorted) {
    const parent = replyTargetOf(event)
    // A reply to a reply, or to a message this channel does not hold: the
    // importer skipped these too, rather than strand one under the wrong root.
    if (!parent || !rootIds.has(parent)) continue
    ;(replies[parent] ??= []).push(asEvent(event))
  }
  return decorate(roots, replies, relayUrl, token)
}

/**
 * The message a `kind:9` replies to, or null for a message — `convex/nostr/sync.ts`'s
 * `replyTargetOf`, which is what put a DM's replies under their messages until REM-1.
 * Buzz's direct reply carries one `e` marked `reply`; a nested one adds `root`.
 */
export function replyTargetOf(event: Pick<SignedEvent, 'tags'>): string | null {
  const eTags = event.tags.filter((t) => t[0] === 'e' && typeof t[1] === 'string')
  if (eTags.length === 0) return null
  const marked = (marker: string) => eTags.find((t) => t[3] === marker)?.[1]
  return marked('reply') ?? marked('root') ?? eTags[0][1] ?? null
}

/** What has been done to every root and reply: the third read, whichever container they came from. */
async function decorate(
  roots: ConversationEvent[],
  replies: Record<string, ConversationEvent[]>,
  relayUrl: string,
  token: StoredToken,
): Promise<FileConversation> {
  const targets = [...roots, ...Object.values(replies).flat()].map((e) => ({ id: e.id, at: e.createdAt }))
  // The edits come back on the decorations read, but interop keeps only the
  // newest one's body. The attachment fold (CON-5) needs every edit, so they
  // are kept here as they pass through rather than asked for a second time.
  const edits: SignedEvent[] = []
  const decorations = await commentDecorationsOf(targets, async (filters) => {
    const result = await queryRelay(relayUrl, filters, token.accessToken, token.pubkey)
    if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
    for (const event of result.events) if (event.kind === KIND.MESSAGE_EDIT) edits.push(event)
    return result.events
  })
  const bodies = [...roots, ...Object.values(replies).flat()].map((e) => ({ id: e.id, body: e.body }))
  return { roots, replies, decorations, edits: foldEdits(bodies, edits) }
}

/*
  The raw events, for their tags. `threadsAsViewer` already fetched every one
  of these and reports a `FileComment` without them; this asks once more by
  id rather than widening that function's answer, because its callers — the
  read-only page for a file Peek cannot write to — have no use for the tags
  and its tests pin its shape. Folded into one read when CON-5 extracts the
  view. Chunked at 100 ids per filter so no single answer is cut.
*/
async function eventsById(ids: string[], relayUrl: string, token: StoredToken): Promise<Map<string, SignedEvent>> {
  const found = new Map<string, SignedEvent>()
  if (ids.length === 0) return found
  const filters: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    filters.push({ ids: chunk, limit: chunk.length })
  }
  const result = await queryRelay(relayUrl, filters, token.accessToken, token.pubkey)
  if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
  for (const event of result.events) found.set(event.id, event)
  return found
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

/**
 * Comment on the file, or reply under one of its comments — the owner's
 * `comment` action with the composer's whole payload.
 *
 * A reply is the same event with NIP-22's lowercase trio redirected at the
 * parent ({@link replyToCommentAsViewer} has the argument); this does that
 * substitution in the same transform that adds the attachments and mentions,
 * so a reply with a picture is one event and not two rules.
 */
export async function commentAsViewer(
  args: {
    container: ConversationContainer
    body: string
    parent?: FileComment
    files?: readonly OutgoingAttachment[]
  },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  const lowercase = new Set(['a', 'e', 'k', 'p'])
  const { container } = args
  const own = container.kind === 'file' ? container.address : ''
  /*
    A pasted app URL is indexed like a `nostr:naddr…` (FOL-38): an `a` for an
    object, a `q` for an event. Resolved before the event is built because the
    address needs the relay; a URL that names nothing stays prose. The two
    sources can name one object twice — a pointer and its link in the same
    sentence — so the union is by tag, not by source.
  */
  const fromUrls = await urlReferenceTagsAsViewer(findUrls(args.body), own, relayUrl, token)
  const seen = new Set<string>()
  const references = [...referenceTagsFor(args.body, own), ...fromUrls].filter((tag) => {
    const key = `${tag[0]}:${tag[1]}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

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
    unsigned.tags.push(...references)
    return publish(unsigned, relayUrl, token, 'The relay refused the message.')
  }

  const extra: NostrTag[] = [...imetaTagsFor(args.files ?? []), ...mentionTagsFor(args.body), ...references]
  const transform = (event: UnsignedActionEvent): UnsignedActionEvent => {
    const parent = args.parent
    const tags = parent
      ? [
          ...event.tags.filter((tag) => !lowercase.has(tag[0])),
          ['e', parent.id],
          ['k', String(parent.kind)],
          ['p', parent.author],
        ]
      : [...event.tags]
    return { ...event, tags: [...tags, ...extra] }
  }
  const result: ActResult & { id?: string } = await applyActionAsViewer(
    { naddr: container.address, actionId: 'comment', value: args.body },
    relayUrl,
    token,
    transform,
  )
  return result.ok && result.id ? { ok: true, id: result.id } : { ok: false, reason: result.reason ?? 'The relay refused the comment.' }
}

/**
 * Edit a comment or a reply — `kind:40003`, newest wins for every reader (CON-8).
 *
 * `files`, when given, is the attachment set after the edit, as `imeta` — RFC
 * 0.4 §7.2.1 as amended 2026-09-23 (CON-5), which {@link foldEdits} reads. A
 * set replaces the one before it, and an edit carrying none leaves the
 * attachments as they were, so an empty set cannot be said: the caller refuses
 * it before it gets here.
 */
export async function editCommentAsViewer(
  args: { container: ConversationContainer; targetEventId: string; body: string; files?: readonly OutgoingAttachment[] },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  const unsigned = buildEdit(token.pubkey, Date.now(), {
    channelUuid: args.container.h,
    targetEventId: args.targetEventId,
    body: args.body,
  })
  if (args.files) unsigned.tags.push(...imetaTagsFor(args.files))
  return publish(unsigned, relayUrl, token, 'The relay refused the edit.')
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
  return publish(buildDeletion(token.pubkey, Date.now(), { targetEventId }), relayUrl, token, 'The relay refused the deletion.')
}

/** React to a comment — `kind:7`. Taking it back is {@link deleteEventAsViewer} on the reaction. */
export async function reactAsViewer(
  args: { targetEventId: string; emoji: string },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  return publish(buildReaction(token.pubkey, Date.now(), args), relayUrl, token, 'The relay refused the reaction.')
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
