/**
 * Seeing a reaction to your message (ACT-7): what writes its conversation's `reactions:` key, so its orange goes, once,
 * everywhere that conversation is drawn.
 *
 * - **Resting on a row**: the card opens, and when it closes after being open, each conversation the card listed a
 *   reaction in is seen up to the newest reaction it listed. Never on opening, so a line does not change while it is
 *   read (the approved prototype: "Leaving the card after it was open clears the orange").
 * - **On a touch screen**, which has no resting, opening the row sees what its card would have listed (the prototype's
 *   touch story).
 * - **Opening the conversation** that draws the reaction under your message sees it there (`useReactionsSeenOn`).
 *
 * Only the reactions shown: a reaction that arrives meanwhile stays new, since the key is the newest shown reaction's
 * `created_at`, never the clock.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-is-seen-once-in-its-conversation.md
 */
import { useCallback, useEffect, useRef } from 'react'
import { rootOf } from '@/nostr/channelStreams'
import { recordReactionsSeen } from '@/nostr/useReadStateSync'
import { reactionLine, reactionsIn, reactionsSeenOf, streamContextsOf } from './reactionNews'
import { hasRelay } from './relayUrl'
import { CARD_LINES, newestFirst, type RowNewsItem } from './rowNews'
import { READ_DWELL_MS } from './unread'
import { useReactionsToMe } from './useReactionsToMe'

/** Nothing open: the hook below asks for nothing. */
const NO_PLACES: readonly string[] = []

/**
 * Opening a conversation that draws reactions to you under your messages sees them there (Miky, 13 Nov): once it has
 * been on screen for `dwellMs` while the page is shown, as a read is marked, each conversation's `reactions:` key
 * goes to the newest such reaction drawn. `places` are the conversations open (a file's address, a team chat's or a
 * DM's channel uuid), whose top-level messages are drawn; `thread` an open thread's root, whose replies are. `drawn` is
 * false until a message is on screen. `onScreen`, when given, is the ids of the messages on screen: only the reactions
 * under those are seen.
 */
export function useReactionsSeenOn({ places = NO_PLACES, thread, drawn = true, dwellMs = READ_DWELL_MS, onScreen }: {
  places?: readonly (string | null | undefined)[]
  thread?: string | null
  drawn?: boolean
  dwellMs?: number
  onScreen?: ReadonlySet<string>
}): void {
  const open = places.filter((place): place is string => !!place)
  const enabled = hasRelay && drawn && (open.length > 0 || !!thread)
  const source = useReactionsToMe(enabled)
  const contexts = open.flatMap(streamContextsOf)
  const lines = !enabled
    ? []
    : (thread ? source.list : reactionsIn(source, contexts)).flatMap((reaction) => {
        const target = source.targetOf.get(reaction.target)
        if (!target || (onScreen && !onScreen.has(target.id))) return []
        const root = rootOf(target)
        // A thread draws its replies (and its root); a conversation its top-level messages, a reply's being in its thread.
        if (thread ? root !== thread : root !== target.id) return []
        return [reactionLine(reaction, source)]
      })
  const writes = reactionsSeenOf(lines)
  const key = writes.map((write) => `${write.context}@${write.atMs}`).sort().join('\n')
  const latest = useRef(lines)
  useEffect(() => {
    latest.current = lines
  })
  useEffect(() => {
    if (!key) return
    let t: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(t)
      if (!document.hidden) t = setTimeout(() => seeReactions(latest.current), dwellMs)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', arm)
    }
  }, [key, dwellMs])
}

/** The reaction lines of what a card draws: its first `drawn` ({@link CARD_LINES} on a row's card), newest first. */
const shownReactions = (items: readonly RowNewsItem[] | undefined, drawn: number): RowNewsItem[] =>
  newestFirst(items ?? [])
    .slice(0, drawn)
    .filter((item) => item.reaction)

/** Whether this screen cannot rest a pointer on a row: a touch screen, where a tap opens the row. */
function cannotHover(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches
  } catch {
    return false
  }
}

/** Write what showing these lines saw. */
export function seeReactions(items: readonly RowNewsItem[]): void {
  if (!hasRelay) return
  recordReactionsSeen(reactionsSeenOf(items))
}

/**
 * For a row whose card lists `items`: `onPreviewOpenChange` for its `NavItem` (or a `PreviewCard`'s `onOpenChange`),
 * which sees the reactions the card listed while it was open once it closes; and `onOpenRow` for the row's click, which
 * sees them on a touch screen only. `drawn` is how many lines the card draws: a row's card five, a page's list all.
 */
export function useReactionsSeenOnClose(
  items: readonly RowNewsItem[] | undefined,
  drawn: number = CARD_LINES,
): {
  onPreviewOpenChange: (open: boolean) => void
  onOpenRow: () => void
} {
  const latest = useRef(items)
  /** The reaction lines listed while the card is open; null while it is closed. */
  const listed = useRef<RowNewsItem[] | null>(null)
  useEffect(() => {
    latest.current = items
    // Lines that came in while the card stayed open were listed too.
    if (listed.current) listed.current = newestFirst(listed.current, shownReactions(items, drawn))
  }, [items, drawn])
  const onPreviewOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        listed.current = shownReactions(latest.current, drawn)
        return
      }
      const lines = listed.current
      listed.current = null
      if (lines?.length) seeReactions(lines)
    },
    [drawn],
  )
  const onOpenRow = useCallback(() => {
    if (!cannotHover()) return
    const lines = shownReactions(latest.current, drawn)
    if (lines.length) seeReactions(lines)
  }, [drawn])
  return { onPreviewOpenChange, onOpenRow }
}
