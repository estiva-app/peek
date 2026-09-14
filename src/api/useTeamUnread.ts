import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FolderSummary } from '@estiva-app/interop'
import { useForeignObjects } from '@/api'
import { validToken } from '@/auth/estivaId'
import type { StreamMessage } from '@/nostr/channelStreams'
import { peekLiveTopics } from '@/nostr/liveTopics'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { teamHasUnread } from './teamUnread'

/** How long the socket's activity is gathered before one re-read pays for all of it. */
export const TEAM_UNREAD_SETTLE_MS = 1_000

/**
 * The dot on each Folder in a list: whether anything in it is new to the
 * viewer — SPEC §11.3, FOL-18.
 *
 * The sidebar's question, and the one the tree (FOL-21) will collapse
 * Folders behind: a team folded shut must still be able to say something
 * inside it needs you. It is the union of the team's streams, judged by
 * `teamHasUnread`, from one batched read of every listed Folder's channel —
 * two `POST /query` for the whole of production's 147, where the listing's
 * per-Folder shape would have been three hundred (`channelStreams.ts`).
 *
 * ## `undefined` is not "nothing new"
 *
 * A Folder absent from `unread` was not judged — no viewer to ask as, a read
 * that failed, or a frontier that has not landed yet — and a caller draws no
 * dot for it rather than a confident dark one. Same rule as the listing's
 * badges, for the same reason: the two are different sentences.
 *
 * ## When it re-reads
 *
 * On the set of Folders changing, on the socket reporting activity in any of
 * them — gathered for a moment, so a burst of comments is one read rather than
 * one each — and on the refresh triggers as the fallback the socket does not
 * cover, exactly as the Folder view keeps its own listing fresh. The judging
 * is separate and cheaper: it runs on every frontier change without a read,
 * which is what turns the dot off when this tab records a file as read.
 */
export function useTeamUnread(folders: readonly FolderSummary[] | null | undefined): {
  unread: Record<string, boolean>
} {
  const { channelStreams } = useForeignObjects()
  /*
    The clock is read with the messages, not while judging: the horizon is
    measured from `at`, and a render must not consult `Date.now()` — the judge
    runs pure, and a boundary ninety days back does not move between reads.
  */
  const [held, setHeld] = useState<{ at: number; streams: Record<string, StreamMessage[]> }>({
    at: 0,
    streams: {},
  })
  const frontier = useReadFrontier()

  /*
    Keyed on the ids, not the array. `useFolders` reads once, but a caller may
    hand a fresh array per render, and what the dots depend on is which Folders
    are listed.
  */
  const key = useMemo(
    () =>
      (folders ?? [])
        .map((folder) => folder.id)
        .sort()
        .join(','),
    [folders],
  )
  const ids = useMemo(() => (key ? key.split(',') : []), [key])

  // A slow read for a previous set must not paint over the current one. Set in
  // an effect, not during render (`react-hooks/refs`), and before `load`'s
  // effect below because effects run in declaration order.
  const current = useRef(key)
  useEffect(() => {
    current.current = key
  }, [key])

  const read = useCallback(async () => {
    const at = Math.floor(Date.now() / 1000)
    const streams = await channelStreams(ids)
    return { at, streams }
  }, [ids, channelStreams])

  const load = useCallback(() => {
    // Nothing to ask about. What is held is not cleared — the judge below only
    // looks up the Folders currently listed, so a stale entry is never drawn.
    if (ids.length === 0) return
    const asked = key
    void read()
      .then((next) => current.current === asked && setHeld(next))
      // A failed read costs the dots, never the list — and it leaves the last
      // answer standing rather than blanking every row on one bad request.
      .catch(() => {})
  }, [ids, key, read])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const live = peekLiveTopics()
    if (!live || ids.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        load()
      }, TEAM_UNREAD_SETTLE_MS)
    }
    const stops = ids.map((folder) => live.onForeignActivity(folder, settle))
    return () => {
      if (timer) clearTimeout(timer)
      for (const stop of stops) stop()
    }
  }, [ids, load])

  useRefreshTriggers(load, { enabled: ids.length > 0 })

  /*
    Judged on every frontier change, not only when the messages arrive — the
    frontier moves when this tab records a read, and that is what turns a dot
    off. A listing's worth of messages against a map lookup each.
  */
  return useMemo(() => {
    const unread: Record<string, boolean> = {}
    // Not judged until the first merge has landed: before that every marker is
    // absent, and "absent" would light the whole sidebar.
    if (!frontier.ready) return { unread }
    const me = validToken()?.pubkey
    for (const folder of ids) {
      const messages = held.streams[folder]
      // Not asked about, or not answered yet: no entry, so no dot either way.
      if (!messages) continue
      unread[folder] = teamHasUnread(folder, messages, {
        marker: frontier.marker,
        me,
        nowSeconds: held.at,
        horizonSeconds: PEEK_HORIZON_DAYS * 24 * 60 * 60,
      })
    }
    return { unread }
  }, [held, frontier, ids])
}
