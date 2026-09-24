/**
 * §2.12's rules, as a function of facts (SHR-10).
 *
 * Split out of `screener.tsx` so the rules can be pinned without a renderer.
 * The provider owns the reads, the optimistic window and the publish; this owns
 * the question "does this conversation want my attention", which is the part
 * that used to run on the server for every user in the workspace and is the
 * part a regression would be silent in.
 *
 * Everything here is pure, including the clock, which arrives as `nowMs`. That
 * is not tidiness: `Date.now()` inside the memo that calls this is impure under
 * the React Compiler's rules, and a rule set that reads the clock itself cannot
 * be tested against a snooze without waiting for it.
 *
 * The file half is all that is folded now. Rules 2 and 3 and the refresh rule
 * judged Convex topics from `screener.candidates`, and went with them (FOL-23).
 */
import type { ScreenerItem } from '@/api/types'
import { fileHasUnread } from '@/api/fileUnread'
import { screenerKey, type InstantMap } from '@/nostr/screener'

export interface ScreenerDecisions {
  snoozed: InstantMap
  dismissed: InstantMap
}

/**
 * A followed file and its comments, as the relay answered them (FOL-34).
 *
 * `comments` is the file's own conversation — what `resolveObject` reads by
 * `#a`, top-level comments only, in any order. That is the same stream the
 * file's unread dot is judged over, so a row here and the dot in the tree
 * cannot disagree about whether there is something new.
 */
export interface ScreenerFile {
  address: string
  kind: number
  title: string
  comments: readonly { id: string; author: string; body: string; createdAt: number }[]
}

/** What the file half is judged against — `fileHasUnread`'s inputs, less the messages. */
export interface ScreenerFileFrontier {
  /** A file's merged marker (`fileContext(address)`), unix seconds; absent = undefined. */
  marker: (address: string) => number | undefined
  me: string | undefined
  nowSeconds: number
  horizonSeconds: number
}

export type FoldedFileItem = Extract<ScreenerItem, { kind: 'file' }>

export interface FoldedFileRow {
  item: FoldedFileItem
  at: number
}

/**
 * Fold followed files into Screener rows, newest first (FOL-34).
 *
 * **The rule is the dot's rule.** A file the viewer follows screens while a
 * comment somebody else wrote on it is unread — `fileHasUnread`, unchanged —
 * and the newest such comment is the preview. Following is the person asking
 * for exactly this, which is why no rule-2-style "never opened" gate applies:
 * that gate exists to keep *unasked-for* topics quiet once looked at. Reading
 * the file advances its marker and retires the row on the next render, with no
 * write, which is the property rule 2 has for topics.
 *
 * The caller passes followed files only. An unfollowed file has no dot (FOL-30)
 * and so no row — the same absence, for the same reason.
 */
export function foldFileScreenerRows(
  files: readonly ScreenerFile[],
  decisions: ScreenerDecisions,
  /** File addresses in open work, off the **list** (PEE-6). */
  openWorkAddresses: ReadonlySet<string>,
  frontier: ScreenerFileFrontier,
  nowMs: number,
): FoldedFileRow[] {
  const rows: FoldedFileRow[] = []
  for (const file of files) {
    if (openWorkAddresses.has(file.address)) continue
    const key = screenerKey('file', file.address)
    const dismissedAt = decisions.dismissed[key] ?? 0
    const judge = {
      file: frontier.marker(file.address),
      // Top-level comments are their own roots, so no thread marker applies.
      thread: () => undefined,
      me: frontier.me,
      nowSeconds: frontier.nowSeconds,
      horizonSeconds: frontier.horizonSeconds,
    }
    let screening: ScreenerFile['comments'][number] | undefined
    for (const comment of file.comments) {
      // `<=`, as for topics: a comment at the instant of the dismissal is the
      // one being dismissed.
      if (comment.createdAt <= dismissedAt) continue
      if (screening && comment.createdAt <= screening.createdAt) continue
      const message = { id: comment.id, at: comment.createdAt, by: comment.author, root: comment.id }
      if (fileHasUnread([message], judge)) screening = comment
    }
    if (!screening) continue
    if ((decisions.snoozed[key] ?? 0) * 1000 > nowMs) continue
    rows.push({
      at: screening.createdAt,
      item: {
        id: fileScreenerRowId(file.address),
        kind: 'file',
        address: file.address,
        fileKind: file.kind,
        title: file.title,
        preview: screening.body,
      },
    })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows
}

const FILE_ROW = 'sc_file_'

export function fileScreenerRowId(address: string): string {
  return `${FILE_ROW}${address}`
}

/** The address a folded file row names, or null for any other row. */
export function fileAddressFromScreenerRowId(id: string): string | null {
  return id.startsWith(FILE_ROW) ? id.slice(FILE_ROW.length) : null
}

