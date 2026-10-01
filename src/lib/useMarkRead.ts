import { useEffect } from 'react'
import { READ_DWELL_MS, useReadActions } from '@/api'

/**
 * Mark a DM and/or an open thread as read once it's been on screen for a
 * moment (§4.3, ruling 2026-07-09):
 *
 *   - opening a DM clears its NEW MESSAGE state
 *   - opening a message's thread panel clears THAT thread's NEW REPLY state
 *
 * The dwell matters: without it, arrowing through a list would silently burn
 * every conversation's unread state. The timer restarts whenever the target
 * changes, so only what you actually settled on is marked read.
 */
export function useMarkRead(dmId: string | null, openThreadId: string | null) {
  const { markContainerRead, markThreadRead } = useReadActions()

  useEffect(() => {
    if (!dmId) return
    const t = setTimeout(() => markContainerRead(dmId), READ_DWELL_MS)
    return () => clearTimeout(t)
    // markContainerRead is recreated each render (fresh mutation binding); the
    // dwell should depend only on WHAT is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmId])

  useEffect(() => {
    if (!openThreadId) return
    const t = setTimeout(() => markThreadRead(openThreadId), READ_DWELL_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThreadId])
}

/**
 * Mark a file's conversation read once its pane has been on screen for a
 * moment — SPEC §11.1–§11.2, FOL-16.
 *
 * The same dwell as above, for the same reason: clicking down a Folder's rows
 * must not silently read every file's talk. Only the file's own stream is
 * advanced; the Folder's channel is not, because the person read one file's
 * conversation and not the team's general chat — and the file's frontier
 * reaches its threads on its own (§11.3), so the pane needs no per-thread mark.
 *
 * `newestAt` is the newest message the pane holds. When it moves, the dwell
 * runs again, so a comment that arrives while the file is open is read too —
 * before PEE-44 the marker stopped 1.5 s after opening and everything said
 * later stayed unread in the other app. A hidden tab marks nothing until it is
 * shown again: a pane in a background tab is not being read.
 */
/** The latest `createdAt` (unix seconds) across a file's comments and replies, or undefined when there are none. */
export function newestMessageAt(...lists: readonly (readonly { createdAt: number }[])[]): number | undefined {
  let newest: number | undefined
  for (const list of lists) for (const m of list) if (newest === undefined || m.createdAt > newest) newest = m.createdAt
  return newest
}

export function useMarkFileRead(address: string | null | undefined, newestAt?: number) {
  const { markFileRead } = useReadActions()

  useEffect(() => {
    if (!address) return
    let t: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(t)
      if (!document.hidden) t = setTimeout(() => markFileRead(address, newestAt), READ_DWELL_MS)
    }
    arm()
    document.addEventListener('visibilitychange', arm)
    return () => {
      clearTimeout(t)
      document.removeEventListener('visibilitychange', arm)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, newestAt])
}
