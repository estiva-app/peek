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
 */
import type { ScreenerItem } from '@/api/types'
import { screenerKey, type InstantMap } from '@/nostr/screener'

/** One event in a container, as `convex/screener.ts`'s `candidates` returns it. */
export interface ScreenerCandidateEvent {
  /** The *message* the hover preview opens onto, as `screenerItems.messageId` was. */
  id: string
  preview: string
  createdAt: number
  isReply: boolean
  mentionsMe: boolean
  /** Whether the viewer wrote in this thread *before* this event. */
  iWroteInThread: boolean
}

export interface ScreenerCandidateContainer {
  kind: 'topic'
  /** Peek's own topic id — a `seedKey` or a Convex id. */
  targetId: string
  isMember: boolean
  everOpened: boolean
  /** Newest first. Urgent events are already excluded — they are Desk Urgent's. */
  events: ScreenerCandidateEvent[]
}

export interface ScreenerDecisions {
  snoozed: InstantMap
  dismissed: InstantMap
}

/** Always a topic row: rule 1 is the DM half and has nothing to fold from. */
export type FoldedItem = Extract<ScreenerItem, { kind: 'topic' }>

export interface FoldedRow {
  item: FoldedItem
  /** The screening event's instant, so the caller can order across both halves. */
  at: number
}

/**
 * Which event, if any, makes this container screen.
 *
 * Exported for the tests, which is the whole reason it is not inline: the three
 * rules are one boolean each and a regression in any of them reads as "the
 * Screener went quiet", which is exactly what a working Screener also looks
 * like on a quiet workspace.
 */
export function screeningEvent(
  container: ScreenerCandidateContainer,
  dismissedAtMs: number,
): ScreenerCandidateEvent | undefined {
  for (const event of container.events) {
    // The dismissal watermark means *ignore this conversation up to now*, which
    // is what the row deletion meant — later traffic re-screened it. So `<=`,
    // not `<`: an event at the very instant of the dismissal is the one being
    // dismissed.
    if (event.createdAt <= dismissedAtMs) continue
    const screens =
      // Rule 3. Being named reaches you whether or not you are a member — that
      // is the point of it, and it is why this is not gated on `isMember`.
      event.mentionsMe ||
      // Rule 2. Not "has unread": *never opened at all*. Once you have opened
      // it, its ordinary traffic stops screening for good, which is what keeps
      // the Screener quiet in the topics you actually follow.
      (container.isMember && !container.everOpened) ||
      // The refresh rule (2026-07-16). A reply in a thread you were already in.
      (event.isReply && event.iWroteInThread)
    // `events` is newest first, so the first that screens carries the preview —
    // "refreshed, never duplicated", which is what `upsert` meant.
    if (screens) return event
  }
  return undefined
}

/**
 * Fold the viewer's topic containers into Screener rows, newest first.
 *
 * `titleFor` resolves a topic id to its title through the workspace index, and
 * returning `undefined` drops the row: the topic is deleted, or the index has
 * not arrived. Either way there is nothing to draw, and no sweep is needed to
 * find that out — it is the read-time healing PEE-6 already relied on, and the
 * reason `convex/topics.ts`'s cross-user screener sweep is not needed.
 */
export function foldScreenerRows(
  containers: readonly ScreenerCandidateContainer[],
  decisions: ScreenerDecisions,
  /** Topic ids in open work, read off the **list** rather than its rendered rows (PEE-6). */
  openWorkTopicIds: ReadonlySet<string>,
  titleFor: (topicId: string) => string | undefined,
  nowMs: number,
): FoldedRow[] {
  const rows: FoldedRow[] = []
  for (const container of containers) {
    // PEE-6, first because it is the cheapest and because a held conversation
    // is not a Screener question at all.
    if (openWorkTopicIds.has(container.targetId)) continue

    const key = screenerKey('topic', container.targetId)
    const event = screeningEvent(container, (decisions.dismissed[key] ?? 0) * 1000)
    if (!event) continue
    // Snooze after the rules, not before: a row that would not exist anyway must
    // not keep a snooze alive in the blob, because `capScreenerBlob` drops an
    // expired one and a live-but-pointless one costs a real entry's bytes.
    if ((decisions.snoozed[key] ?? 0) * 1000 > nowMs) continue

    const title = titleFor(container.targetId)
    if (title === undefined) continue
    rows.push({
      at: event.createdAt,
      item: {
        id: screenerRowId(container.targetId),
        kind: 'topic',
        topicId: container.targetId,
        topicTitle: title,
        preview: event.preview,
      },
    })
  }
  rows.sort((a, b) => b.at - a.at)
  return rows
}

/** The synthetic row id for a folded topic. There is no Convex row to name. */
const TOPIC_ROW = 'sc_topic_'

export function screenerRowId(topicId: string): string {
  return `${TOPIC_ROW}${topicId}`
}

/** The topic id a folded row names, or null for a DM row's Convex id. */
export function topicIdFromScreenerRowId(id: string): string | null {
  return id.startsWith(TOPIC_ROW) ? id.slice(TOPIC_ROW.length) : null
}
