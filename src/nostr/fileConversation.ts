/**
 * A file's conversation as Peek's own — the reads and writes behind the
 * Topics view on `kind:1111` (FOL-31).
 *
 * **One conversation, parameterised by container.** Peek's Topics view reads
 * `kind:9` in a channel through Convex; a file's conversation is `kind:1111`
 * on the relay, read by `#a`. The view is the same set of components either
 * way; what differs is here, and this module is the only place a kind number
 * for a file's talk is written. `ConversationContainer` is the DMS-5
 * `containerKind`/`containerKey` idea with the file as a member: today it has
 * one shape, and FOL-35 adds `{ kind: 'channel', h }` for a team's general
 * `kind:9` chat, which reads by `#h` and writes with `buildMessage` — the
 * same view, one more branch in this file and nowhere else.
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
 * publishes it, with the composer's attachments as `imeta` (CON-12) and its
 * mentions as `p`. Everything else is a plain protocol event at the comment:
 * `kind:40003` to edit (CON-8), `kind:5` to delete or to take a reaction back
 * (CON-3 — the relay adjudicates, the client does not pre-judge), `kind:7` to
 * react, `kind:9101` to resolve or reopen (PEEK-128). No Convex row is written
 * for any of it: the relay is the only store a file's conversation has, so what
 * the page shows after a write is what it re-reads.
 */
import {
  buildDeletion,
  buildEdit,
  buildReaction,
  buildResolution,
  decodeNpub,
  findNostrUris,
  imetaOf,
  imetaTag,
  type NostrTag,
  type ResolutionAction,
  type SignedEvent,
} from '@estiva-app/protocol'
import { commentDecorationsOf, type CommentDecorations } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import type { UnsignedActionEvent } from '@estiva-app/interop'
import { publishSigned, queryRelay, signViaEstivaId } from './bridge'
import { RelayReadError } from './relayRead'
import { applyActionAsViewer, threadsAsViewer, type ActResult, type FileComment, type FileThreads } from './foreign'

/** Where a conversation lives. One shape today; see the module header. */
export type ConversationContainer = {
  kind: 'file'
  /** The file's address — what its comments carry as `a`. */
  address: string
  /** The file's Folder — what every event written into this conversation carries as `h`. */
  h: string
}

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
 * The whole conversation below the roots: replies, and what has been done to
 * every root and reply.
 *
 * The roots are re-fetched by id inside {@link threadsAsViewer} — their `kind`
 * and their tags are reported by no projection — so this is where their
 * attachments come from too. Throws `RelayReadError` on a refused read, like
 * every read here: an unreadable conversation is not an empty one.
 */
export async function fileConversationAsViewer(
  container: ConversationContainer,
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
    .map((root) => withTags(root, raw.get(root.id), container.address))
  const replies: Record<string, ConversationEvent[]> = {}
  for (const [rootId, list] of Object.entries(threads.replies)) {
    replies[rootId] = list.map((reply) => withTags(reply, raw.get(reply.id), container.address))
  }

  const targets = [...roots, ...Object.values(replies).flat()].map((e) => ({ id: e.id, at: e.createdAt }))
  const decorations = await commentDecorationsOf(targets, async (filters) => {
    const result = await queryRelay(relayUrl, filters, token.accessToken, token.pubkey)
    if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
    return result.events
  })
  return { roots, replies, decorations }
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

async function publish(unsigned: Parameters<typeof signViaEstivaId>[0], relayUrl: string, token: StoredToken, fallback: string): Promise<WriteResult> {
  const signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
  const result = await publishSigned(relayUrl, signed, token.accessToken, token.pubkey)
  // The signed id is known before the relay answers; `eventId` is what the
  // bridge reports when it parsed one, and the two are the same event.
  return refused({ ...result, eventId: result.ok ? (result.eventId ?? signed.id) : undefined }, fallback)
}

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
  const extra: NostrTag[] = [...imetaTagsFor(args.files ?? []), ...mentionTagsFor(args.body)]
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
    { naddr: args.container.address, actionId: 'comment', value: args.body },
    relayUrl,
    token,
    transform,
  )
  return result.ok && result.id ? { ok: true, id: result.id } : { ok: false, reason: result.reason ?? 'The relay refused the comment.' }
}

/** Edit a comment or a reply — `kind:40003`, newest wins for every reader (CON-8). */
export async function editCommentAsViewer(
  args: { container: ConversationContainer; targetEventId: string; body: string },
  relayUrl: string,
  token: StoredToken,
): Promise<WriteResult> {
  const unsigned = buildEdit(token.pubkey, Date.now(), {
    channelUuid: args.container.h,
    targetEventId: args.targetEventId,
    body: args.body,
  })
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
