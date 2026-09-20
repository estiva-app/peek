/**
 * Where else a file was named — the mentions half of a file's Activity (CON-11).
 *
 * ## A mention is the `a` tag, not the body
 *
 * A person writing another file into a comment picks it from the `[` menu,
 * which serialises to `nostr:naddr…` in the body, and `commentAsViewer` carries
 * every such address as an `a` tag on the `kind:1111`
 * (`referenceTagsFor`, the rule `convex/nostr/refs.ts` applies to a `kind:9`).
 * The body is the source and the tag is the index — one `#a` filter answers
 * "who named this file" across every Folder the viewer can read, where reading
 * bodies would mean reading every conversation. The relay's own mention index
 * is `p`-tag based and knows nothing about addresses, so this is not it.
 *
 * ## Every conversation but this file's own
 *
 * The same `#a` read is how a file's *own* comments are found
 * (`resolveForeignObject`), so the answer holds both and NIP-22's case tells
 * them apart: `A` is the thread's root object. A comment whose `A` is this
 * file is its conversation, and *identity merges* — it is already in the
 * stream. A comment whose `A` is another file is that file's conversation and
 * this file's Activity. A comment with no `A` at all predates the tag and is
 * read as a comment on the file, the way `isCommentOn` reads it.
 *
 * Nothing is thrown away for having an `e` tag. A reply that carries the
 * address is still somebody naming the file, and the row opens the thread it
 * was said in, so a reply and a root read the same way.
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
import { attachmentsOf, isCommentOn, type RelayAttachment } from './fileConversation'

/** One comment, in some other file's conversation, that names this file. */
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
  /** The file it was said on — NIP-22's `A`. What the row says, and where it opens. */
  saidIn: string
  /** The thread it belongs to there: the parent a reply names by `e`, or itself. */
  threadId: string
  /** Every address it names, the mentioned file included, in tag order. */
  references: string[]
  files: RelayAttachment[]
}

/**
 * Enough for a panel that is scanned, not read. The list is newest first, so
 * what a cap drops is the oldest mention, which is the right end.
 */
export const FILE_MENTIONS_LIMIT = 200

/** The one filter: every comment that tags the address. */
export function fileMentionFilter(address: string, limit = FILE_MENTIONS_LIMIT): Record<string, unknown> {
  return { kinds: [KIND.COMMENT], '#a': [address], limit }
}

const tagsNamed = (event: SignedEvent, name: string): string[] =>
  event.tags.filter((t) => t[0] === name && typeof t[1] === 'string' && t[1]).map((t) => t[1])

/**
 * The mentions among a relay answer: tagged with the address, rooted on some
 * other file, newest first, one row per event.
 *
 * Pure, so the claim — a comment on the file is not a mention of it — is
 * provable without a relay.
 */
export function fileMentionsOf(events: readonly SignedEvent[], address: string): FileMention[] {
  const seen = new Set<string>()
  const out: FileMention[] = []
  for (const event of events) {
    if (seen.has(event.id)) continue
    if (isCommentOn(event, address)) continue
    const saidIn = tagsNamed(event, 'A')[0]
    const folder = tagsNamed(event, 'h')[0]
    if (!saidIn || !folder) continue
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
      saidIn,
      threadId: tagsNamed(event, 'e')[0] ?? event.id,
      references,
      files: attachmentsOf(event),
    })
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Every comment, on any file the viewer can read, that names this file.
 *
 * Throws {@link RelayReadError} on a refused read, like every read in
 * `foreign.ts`: an unreadable relay and a file nobody has mentioned must not
 * be the same empty list.
 */
export async function fileMentionsAsViewer(address: string, relayUrl: string, token: StoredToken): Promise<FileMention[]> {
  const result = await queryRelay(relayUrl, [fileMentionFilter(address)], token.accessToken, token.pubkey)
  if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
  return fileMentionsOf(result.events, address)
}
