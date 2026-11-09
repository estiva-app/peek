import { useEffect, useRef } from 'react'
import { READ_DWELL_MS, useReadActions } from '@/api'

/**
 * What is open gets marked read once it has been on screen for a moment — SPEC
 * §11.1–§11.2, ruling 2026-07-09, PEE-44:
 *
 *   - an open DM or file reads its top-level messages
 *   - an open thread reads that thread's replies, and nothing else does
 *
 * The dwell matters: without it, arrowing through a list would silently burn
 * every conversation's unread state. The timer restarts whenever the target
 * changes, so only what you actually settled on is marked read.
 *
 * `newestAt` is the newest message drawn for the target (unix seconds), and the
 * mark goes up to it rather than the clock: the relay may hold one the pane has
 * not drawn yet, and an author whose clock runs ahead would otherwise stay
 * newer than the marker. When it moves the dwell runs again, so a message that
 * arrives while the target is open is read too — before PEE-44 a DM's marker
 * stopped 1.5 s after opening and everything said later stayed unread. Until a
 * message is drawn nothing is marked: there is nothing on screen to have read.
 *
 * A hidden tab marks nothing until it is shown again: a pane in a background
 * tab is not being read.
 *
 * The mark never passes the clock. `createdAt` is the sender's to choose, and
 * the relay accepts one up to 15 minutes ahead: marking up to it would set a
 * grow-only marker in the future, and everything others said until then would
 * read as read without being drawn. A message ahead of the clock is read once
 * the clock reaches it, while the pane is still open.
 *
 * Peek's own conversation view passes what has been on screen rather than
 * what is drawn (the kit's `useSeenOnScreen`, Katerina, 30 October), and no dwell of its
 * own: being seen already took one.
 */
function useDwell(target: string | null | undefined, newestAt: number | undefined, mark: (target: string, newestAt: number) => void, dwellMs: number) {
  useEffect(() => {
    if (!target || newestAt === undefined) return
    let t: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      const now = Math.floor(Date.now() / 1000)
      mark(target, Math.min(newestAt, now))
      // Ahead of the clock: read it once the clock gets there, if still open.
      if (newestAt > now) t = setTimeout(fire, (newestAt - now) * 1000)
    }
    const arm = () => {
      clearTimeout(t)
      if (!document.hidden) t = setTimeout(fire, dwellMs)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', arm)
    }
    // `mark` is recreated each render (fresh mutation binding); the dwell
    // should depend only on WHAT is open and what it shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, newestAt, dwellMs])
}

/** The latest `createdAt` (unix seconds) across the lists, or undefined when there are none. */
export function newestMessageAt(...lists: readonly (readonly { createdAt: number }[])[]): number | undefined {
  let newest: number | undefined
  for (const list of lists) for (const m of list) if (newest === undefined || m.createdAt > newest) newest = m.createdAt
  return newest
}

/**
 * Mark an open DM read up to its newest top-level message. Never a reply's
 * time: the DM's marker reaches its threads (§11.3), so a reply newer than the
 * newest top-level message stays unread — and the DM's dot lit — until its
 * thread is opened (Miky, 2026-10-03).
 */
export function useMarkDmRead(dmId: string | null, newestAt: number | undefined, dwellMs = READ_DWELL_MS) {
  const { markContainerRead } = useReadActions()
  useDwell(dmId, newestAt, markContainerRead, dwellMs)
}

/** Mark an open team chat read up to its newest top-level message, as a DM is (TEA-5). */
export function useMarkChannelRead(channelUuid: string | null, newestAt: number | undefined, dwellMs = READ_DWELL_MS) {
  const { markChannelRead } = useReadActions()
  useDwell(channelUuid, newestAt, markChannelRead, dwellMs)
}

/**
 * Mark a file's conversation read up to its newest top-level comment — FOL-16.
 *
 * Only the file's own stream is advanced; the Folder's channel is not, because
 * the person read one file's conversation and not the team's general chat. Its
 * replies are left to their threads, as a DM's are.
 */
export function useMarkFileRead(address: string | null | undefined, newestAt: number | undefined, dwellMs = READ_DWELL_MS) {
  const { markFileRead } = useReadActions()
  useDwell(address, newestAt, markFileRead, dwellMs)
}

/**
 * Mark each file read up to its newest top-level comment seen on screen, when one view draws several files'
 * conversations: a topic at All draws every listed file's threads beside its own, and reading one there reads it in
 * that file's own stream, so Ship and the file's own page agree (TOPI-3). The topic's own stream is
 * {@link useMarkFileRead}'s, as before.
 *
 * As the view's own mark: no dwell of its own (being seen already took one), never past the clock (a comment ahead
 * of it is read once the clock gets there, while the view is open), nothing while the tab is hidden, and one
 * `markFileRead` per file whose newest seen comment moved.
 */
export function useMarkFilesRead(seenAtOf: ReadonlyMap<string, number> | undefined) {
  const { markFileRead } = useReadActions()
  const marked = useRef(new Map<string, number>())
  // By value: the view builds the map on every render.
  const seen = seenAtOf ? [...seenAtOf].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : []
  const signature = seen.map(([address, at]) => `${address}@${at}`).join(',')
  useEffect(() => {
    if (!signature) return
    const wanted = signature.split(',').map((one) => {
      const at = one.lastIndexOf('@')
      return [one.slice(0, at), Number(one.slice(at + 1))] as const
    })
    let t: ReturnType<typeof setTimeout> | undefined
    const fire = () => {
      const now = Math.floor(Date.now() / 1000)
      let ahead: number | undefined
      for (const [address, newestAt] of wanted) {
        const upTo = Math.min(newestAt, now)
        if ((marked.current.get(address) ?? -1) < upTo) {
          marked.current.set(address, upTo)
          markFileRead(address, upTo)
        }
        if (newestAt > now) ahead = Math.min(ahead ?? newestAt, newestAt)
      }
      // Ahead of the clock: read it once the clock gets there, if still open.
      if (ahead !== undefined) t = setTimeout(fire, (ahead - now) * 1000)
    }
    const arm = () => {
      clearTimeout(t)
      if (!document.hidden) t = setTimeout(fire, 0)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', arm)
    }
    // `markFileRead` is recreated each render; the marks depend only on what was seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])
}

/**
 * Mark the open thread read up to its newest reply — the only thing that reads
 * a reply (Miky, 2026-10-03). Advances the thread and never its DM or file
 * (§11.2). `rootId` is the root's event id.
 */
export function useMarkThreadRead(rootId: string | null | undefined, newestAt: number | undefined, dwellMs = READ_DWELL_MS) {
  const { markThreadRead } = useReadActions()
  useDwell(rootId, newestAt, markThreadRead, dwellMs)
}
