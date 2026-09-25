/**
 * A Folder's channel as streams — the read behind a team's unread dot (FOL-18).
 *
 * SPEC §11.3: a team's indicator is the **union of its streams** — its general
 * conversation, every file's conversation, and every Folder beneath it. It is
 * a display rule computed at read time from the markers that already exist;
 * nothing is written for it and the reserved `folder:` grain (§11.5) stays
 * untouched. Deciding it needs each stream's messages against each stream's
 * own marker, and the cost question is how to fetch them for every row in a
 * sidebar.
 *
 * ## Why not the listing's shape
 *
 * The listing asks per Folder: `resolveFolderContents` for the files,
 * `conversationsOf` for their comments, and a children fetch for each project
 * before its issues count at all. That is at least two `POST /query` per
 * Folder against a 300/min meter shared across every app the person has open.
 * Production had 147 Folders on 2026-09-13, so a sidebar load would have spent
 * the whole minute's budget and still not seen the issues under any project.
 *
 * ## One tag makes it flat
 *
 * Everything said in a Folder carries the Folder's uuid as `h` — Peek's
 * `kind:9` and Ship's `kind:1111` alike, and both kinds for ever, because a
 * comment written before Ship flipped stays `kind:9` — and a message about a
 * file carries the file's address as `a` on top. So one filter per Folder,
 * batched `MAX_FILTERS_PER_QUERY` to a POST, returns every stream of every
 * Folder at once: measured **2 POSTs, 449 ms and 838 events for all 147**, no
 * Folder near the per-filter limit. Which stream a message belongs to is then
 * read off the message itself — an `a` names the file's stream, none means the
 * general one — with no manifest and no walk of the files, so an issue nested
 * under a project counts without anybody fetching the project's children.
 *
 * The cost of the flat read is that a file *placed* in a Folder whose talk
 * happens under another channel's `h` — a Ship project linked into a team
 * Folder, which is what FOL-20 does — lights the Folder it is talked in, not
 * the one it is linked into. That is the row with the conversation, and the
 * tree (FOL-21) is where the two rows meet.
 *
 * Pure by construction, like `readState.ts`: the filters, the batching and the
 * grouping run against an injected query, so they can be exercised without a
 * browser. The viewer's query lives in `foreign.ts`.
 */
import { KIND, MAX_FILTERS_PER_QUERY, type SignedEvent } from '@estiva-app/protocol'
import { CONVERSATION_LIMIT, type ConversationMessage, type QueryFn } from '@estiva-app/interop'

/** A message in a Folder's channel, with the file streams it belongs to. */
export interface StreamMessage extends ConversationMessage {
  /**
   * The file addresses the message names — its `a` tags, in tag order — or
   * empty for a message in the general stream. Every one, not the first:
   * a message about two files is in both of their streams.
   */
  about: string[]
  /**
   * The composer's urgent marker was in the body (SHR-5). Carried on the
   * message because a topic's sidebar indicator is two signals, not one, and
   * the second cannot be read off anything but the text.
   */
  urgent: boolean
  /**
   * The text as sent. The Screener's DM half previews from it (CON-14), which
   * is why a DM row costs no read of its own: the dots already hold the channel.
   */
  body: string
}

/**
 * `!@` — the composer's urgent marker (§2.12), read off the wire.
 *
 * It had a twin, Convex's `isUrgentBody`, until REM-7 deleted `convex/`; this
 * is the only copy now.
 */
export function isUrgentContent(content: string | undefined): boolean {
  return content !== undefined && content.includes('!@')
}

/**
 * The newest this many per Folder, inside the horizon. The listing's own
 * ceiling per file; a Folder is busier than a file, but the busiest on
 * production held 82 in 90 days, and a Folder past it is judged on its newest
 * two hundred — which is the end a new message lands on.
 */
export const CHANNEL_STREAM_LIMIT = CONVERSATION_LIMIT

/** One filter per Folder: everything said in it since `sinceSeconds`. */
export function channelStreamFilters(
  folderIds: readonly string[],
  sinceSeconds: number,
  limit: number = CHANNEL_STREAM_LIMIT,
): Record<string, unknown>[] {
  return folderIds.map((folder) => ({
    kinds: [KIND.STREAM_MESSAGE, KIND.COMMENT],
    '#h': [folder],
    since: sinceSeconds,
    limit,
  }))
}

/**
 * Which thread a message is in: NIP-22's `E`, else the first `e` — the root
 * in both shapes `threadTags` writes — else the message is a root. The same
 * reading `@estiva-app/interop` applies to a file's conversation, so a reply
 * is judged against the same `thread:` marker on both surfaces.
 */
export function rootOf(event: SignedEvent): string {
  const upper = event.tags.find((t) => t[0] === 'E' && t[1])?.[1]
  if (upper) return upper
  const lower = event.tags.find((t) => t[0] === 'e' && t[1])?.[1]
  return lower ?? event.id
}

/**
 * The events by Folder, as stream messages. A Folder that was asked about is
 * present with `[]` when nothing was said in it; one that was not asked about
 * is absent, so a caller can keep "quiet" and "unasked" apart.
 */
export function streamMessagesByFolder(
  events: readonly SignedEvent[],
  folderIds: readonly string[],
): Record<string, StreamMessage[]> {
  const byFolder: Record<string, StreamMessage[]> = {}
  for (const folder of folderIds) byFolder[folder] = []
  const seen = new Set<string>()
  for (const event of events) {
    // One `h` per event, so a filter per Folder cannot answer the same event
    // twice — but a relay is allowed to, and a duplicate costs nothing to drop.
    if (seen.has(event.id)) continue
    seen.add(event.id)
    const folder = event.tags.find((t) => t[0] === 'h' && t[1])?.[1]
    if (!folder || !(folder in byFolder)) continue
    byFolder[folder].push({
      id: event.id,
      at: event.created_at,
      by: event.pubkey,
      root: rootOf(event),
      about: event.tags.filter((t) => t[0] === 'a' && t[1]).map((t) => t[1]),
      urgent: isUrgentContent(event.content),
      body: event.content,
    })
  }
  return byFolder
}

/**
 * Every stream of every Folder listed, in as few requests as the relay allows.
 *
 * `sinceSeconds` is the horizon: a marker older than it has aged out of the
 * merge, and a message older than it is not something the person missed since
 * (`fileHasUnread` says how absence is read), so nothing older is worth
 * fetching for this question.
 */
export async function readChannelStreams(
  folderIds: readonly string[],
  sinceSeconds: number,
  query: QueryFn,
): Promise<Record<string, StreamMessage[]>> {
  const filters = channelStreamFilters(folderIds, sinceSeconds)
  const events: SignedEvent[] = []
  for (let start = 0; start < filters.length; start += MAX_FILTERS_PER_QUERY) {
    events.push(...(await query(filters.slice(start, start + MAX_FILTERS_PER_QUERY))))
  }
  return streamMessagesByFolder(events, folderIds)
}
