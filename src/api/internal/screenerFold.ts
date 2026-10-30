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
 * Both halves are folded: rule 1 (a DM) from the channel store since CON-14,
 * and a member file from its conversation since FOL-34. Rules 2 and 3 and the
 * refresh rule judged Convex topics from `screener.candidates`, and went with
 * them (FOL-23).
 */
import type { ScreenerItem } from '@/api/types'
import { fileHasUnread } from '@/api/fileUnread'
import { type StreamFrontier, type StreamTerms, streamHasUnread } from '@/api/streamUnread'
import { screenerKey, type InstantMap } from '@/nostr/screener'
import { REPLY_FLOOR_CONTEXT, channelContext, fileContext, threadContext } from '@estiva-app/conversation'
import type { StreamMessage } from '@/nostr/channelStreams'

export interface ScreenerDecisions {
  snoozed: InstantMap
  dismissed: InstantMap
}

/**
 * A member file and its comments, as the relay answered them (FOL-34).
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
  /** Its summary (SPEC §6.12), for Desk's Urgent row. */
  summary?: string
  /** Archived, itself or with a file above it: the row stays while unread, marked (PEE-68). */
  archived?: boolean
  comments: readonly { id: string; author: string; body: string; createdAt: number }[]
}

/** What the file half is judged against — `streamHasUnread`'s inputs, less the messages. */
export interface ScreenerFileFrontier extends StreamFrontier {
  /** The terms a file is told about on, by address (SPEC §11.8). */
  termsOf: (address: string) => StreamTerms
  /** Whether a comment names the viewer: it counts through a mute. */
  isMentioned: (commentId: string) => boolean
}

export type FoldedFileItem = Extract<ScreenerItem, { kind: 'file' }>

export interface FoldedFileRow {
  item: FoldedFileItem
  at: number
  /** The comment the row previews — the hover card reads its replies (CON-14). */
  commentId: string
}

/**
 * Fold member files into Screener rows, newest first (FOL-34, CON-19).
 *
 * **The rule is the dot's rule.** A file the viewer is a member of screens
 * while a comment somebody else wrote on it since they joined is unread —
 * `streamHasUnread`, SPEC §11.8 — and the newest such comment is the preview.
 * Membership is the person being involved, which is why no rule-2-style "never
 * opened" gate applies: that gate exists to keep *unasked-for* topics quiet
 * once looked at. Reading
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
    const context = fileContext(file.address)
    if (!context) continue
    const terms = frontier.termsOf(file.address)
    let screening: ScreenerFile['comments'][number] | undefined
    for (const comment of file.comments) {
      // `<=`, as for topics: a comment at the instant of the dismissal is the
      // one being dismissed.
      if (comment.createdAt <= dismissedAt) continue
      if (screening && comment.createdAt <= screening.createdAt) continue
      const message = { id: comment.id, at: comment.createdAt, by: comment.author, root: comment.id }
      // Top-level comments are their own roots, so no thread marker applies.
      if (streamHasUnread([message], context, terms, frontier, frontier.isMentioned)) screening = comment
    }
    if (!screening) continue
    if ((decisions.snoozed[key] ?? 0) * 1000 > nowMs) continue
    rows.push({
      at: screening.createdAt,
      commentId: screening.id,
      item: {
        id: fileScreenerRowId(file.address),
        kind: 'file',
        address: file.address,
        fileKind: file.kind,
        title: file.title,
        preview: screening.body,
        ...(file.archived ? { archived: true } : {}),
      },
    })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows
}

/** A file in Desk's Urgent (CON-17). */
export interface FoldedUrgentFile {
  address: string
  kind: number
  title: string
  summary?: string
  /** The newest unread urgent comment's instant, unix seconds. */
  at: number
}

/**
 * The files with an unread comment urgent for the viewer, newest first —
 * Desk's Urgent for files (CON-17, FOL-43).
 *
 * The file dot's rule over the urgent comments alone, as a DM is in Urgent
 * exactly when its sidebar row shows the urgent indicator: somebody else's
 * comment that names the viewer urgently (`isUrgent`, SPEC §13.1) and is past
 * the file's marker. Reading the file retires it, with no write. The Screener's
 * decisions and open work do not apply: Later and the X are for what can wait.
 */
export function foldUrgentFiles(
  files: readonly ScreenerFile[],
  frontier: ScreenerFileFrontier & { isUrgent: (commentId: string) => boolean },
): FoldedUrgentFile[] {
  const rows: FoldedUrgentFile[] = []
  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.address)) continue
    seen.add(file.address)
    const context = fileContext(file.address)
    if (!context) continue
    const terms = frontier.termsOf(file.address)
    let at: number | undefined
    for (const comment of file.comments) {
      if (!frontier.isUrgent(comment.id) || (at !== undefined && comment.createdAt <= at)) continue
      const message = { id: comment.id, at: comment.createdAt, by: comment.author, root: comment.id }
      if (streamHasUnread([message], context, terms, frontier, frontier.isMentioned)) at = comment.createdAt
    }
    if (at !== undefined) rows.push({ address: file.address, kind: file.kind, title: file.title, ...(file.summary ? { summary: file.summary } : {}), at })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows
}

/** A DM the viewer has a channel for, and what the channel store holds of it (CON-14). */
export interface ScreenerDm {
  /** The partner's pubkey — the DM's id everywhere (REM-3). */
  partner: string
  /** The channel uuid, which is the read-state context (SPEC §11.1). */
  channel: string
  authorName: string
  authorAvatarSrc?: string
  /** The channel's messages inside the horizon, any order. */
  messages: readonly StreamMessage[]
}

/** What the DM half is judged against — the DM dot's inputs (`topicChannelFlags`). */
export interface ScreenerDmFrontier {
  /** One context's merged marker, unix seconds; absent = undefined. */
  marker: (context: string | undefined) => number | undefined
  me: string | undefined
  nowSeconds: number
  horizonSeconds: number
}

export type FoldedDmItem = Extract<ScreenerItem, { kind: 'dm' }>

export interface FoldedDmRow {
  item: FoldedDmItem
  at: number
  /** The message the row previews — the hover card starts its thread here. */
  messageId: string
}

/**
 * Fold DMs into Screener rows, newest first — rule 1, "someone DMs you" (CON-14).
 *
 * **The rule is the DM dot's rule**, as the file half's is the file dot's: a DM
 * screens while a message somebody else sent in it is unread, judged exactly as
 * `topicChannelFlags` judges it — the channel's marker, and for a reply the
 * later of that and its thread's. The newest such message is the preview.
 *
 * That is a change from Convex, whose row was written by `messages.send` and
 * stayed until the person dismissed or opened it from the Screener. Here,
 * reading the DM retires the row, with no write — the property the file half
 * already has, and the reason a row and the sidebar dot cannot disagree.
 */
export function foldDmScreenerRows(
  dms: readonly ScreenerDm[],
  decisions: ScreenerDecisions,
  /** Partner pubkeys in open work, off the **list** (PEE-6). */
  openWorkPartners: ReadonlySet<string>,
  frontier: ScreenerDmFrontier,
  nowMs: number,
): FoldedDmRow[] {
  const rows: FoldedDmRow[] = []
  for (const dm of dms) {
    if (openWorkPartners.has(dm.partner)) continue
    const key = screenerKey('dm', dm.partner)
    const dismissedAt = decisions.dismissed[key] ?? 0
    const judge = {
      file: frontier.marker(channelContext(dm.channel)),
      thread: (root: string) => frontier.marker(threadContext(root)),
      floor: frontier.marker(REPLY_FLOOR_CONTEXT),
      me: frontier.me,
      nowSeconds: frontier.nowSeconds,
      horizonSeconds: frontier.horizonSeconds,
    }
    let screening: StreamMessage | undefined
    for (const message of dm.messages) {
      if (message.at <= dismissedAt) continue
      if (screening && message.at <= screening.at) continue
      if (fileHasUnread([message], judge)) screening = message
    }
    if (!screening) continue
    if ((decisions.snoozed[key] ?? 0) * 1000 > nowMs) continue
    rows.push({
      at: screening.at,
      messageId: screening.id,
      item: {
        id: dmScreenerRowId(dm.partner),
        kind: 'dm',
        dmId: dm.partner,
        authorName: dm.authorName,
        authorAvatarSrc: dm.authorAvatarSrc,
        preview: screening.body,
      },
    })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows
}

/**
 * The hover card's messages for a DM row: the thread the screening message is
 * in — its root, then the last four replies — as `screener.preview` chose them.
 * From the channel store, oldest first; a root older than the horizon is simply
 * not there, and the replies stand on their own.
 */
export function dmPreviewMessages(messages: readonly StreamMessage[], messageId: string): StreamMessage[] {
  const screening = messages.find((m) => m.id === messageId)
  if (!screening) return []
  const root = screening.root
  const head = messages.find((m) => m.id === root)
  const replies = messages
    .filter((m) => m.root === root && m.id !== root)
    .sort((a, b) => a.at - b.at)
    .slice(-4)
  return head ? [head, ...replies] : replies
}

const DM_ROW = 'sc_dm_'

export function dmScreenerRowId(partner: string): string {
  return `${DM_ROW}${partner}`
}

/** The partner a folded DM row names, or null for any other row. */
export function dmPartnerFromScreenerRowId(id: string): string | null {
  return id.startsWith(DM_ROW) ? id.slice(DM_ROW.length) : null
}

const FILE_ROW = 'sc_file_'

export function fileScreenerRowId(address: string): string {
  return `${FILE_ROW}${address}`
}

/** The address a folded file row names, or null for any other row. */
export function fileAddressFromScreenerRowId(id: string): string | null {
  return id.startsWith(FILE_ROW) ? id.slice(FILE_ROW.length) : null
}

