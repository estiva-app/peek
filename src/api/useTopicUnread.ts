import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForeignObjects } from '@/api/foreign'
import { validToken } from '@/auth/estivaId'
import type { StreamMessage } from '@/nostr/channelStreams'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { topicChannelFlags } from './topicUnread'

/** What the fold needs of a topic: the sidebar's key, and the channel to read. */
export interface TopicChannel {
  /** The client-visible topic id — what the sidebar asks about. */
  id: string
  /** The topic's channel uuid, or null/undefined for a topic never published. */
  folderId?: string | null
}

/**
 * The sidebar's topic dots and urgent indicators, folded from the relay —
 * SHR-5, §4.3.
 *
 * The same read FOL-18 measured, pointed at topic channels instead of team
 * Folders: one filter per channel, batched to a POST, every message inside the
 * horizon. Production has 26 topics, so this is **one** `POST /query` for the
 * whole sidebar, where `unread.summary` walked every message in every topic
 * and every reply on every message to answer the same question.
 *
 * ## What it replaces, and what it does not
 *
 * The topic half only. Huddles are not channels and DMs are not on the relay
 * yet, so both stay in Convex — `unread.summary` keeps them, and `useUnread`
 * unions the two answers. A topic's dot is the union of its own channel and
 * any huddle under it, and the huddle side of that union arrives from there.
 *
 * ## `undefined` is not "nothing new"
 *
 * A topic absent from the maps was not judged — no viewer, a read that failed,
 * a frontier that has not landed, or a topic with no channel — and a caller
 * draws no dot rather than a confident dark one. Same rule as FOL-18's, for
 * the same reason.
 *
 * ## When it re-reads
 *
 * On the set of topics changing, and on the refresh triggers — focus,
 * visibility, and a 30 s interval. The socket path `useTeamUnread` uses does
 * not help here: `onForeignActivity` fires for events the projection did *not*
 * take, and a topic's own `kind:9` is exactly what it takes. So a message
 * arriving in a topic you are not looking at lights its dot within the
 * interval rather than instantly, which is slower than the Convex query was.
 * Judging is separate and free: it re-runs on every frontier change without a
 * read, which is what turns a dot off the moment this tab records a read.
 */
export function useTopicUnread(
  topics: readonly TopicChannel[] | null | undefined,
  /**
   * `unread.summary`'s `topicMarks` — this deployment's cached watermark per
   * channel uuid, unix seconds. Raises the relay marker, never lowers it;
   * `topicUnread.ts` says why a relay fold still wants it.
   */
  cachedMarks?: Readonly<Record<string, number>> | undefined,
): {
  unread: Record<string, boolean>
  urgent: Record<string, boolean>
} {
  const { channelStreams } = useForeignObjects()
  /*
    The clock is read with the messages, not while judging: the horizon is
    measured from `at`, and a render must not consult `Date.now()`.
  */
  const [held, setHeld] = useState<{ at: number; streams: Record<string, StreamMessage[]> }>({
    at: 0,
    streams: {},
  })
  const frontier = useReadFrontier()

  /*
    Keyed on the pairs, not the array: `useTopics` hands back a fresh array per
    render, and what the dots depend on is which topics are listed and which
    channel each reads from — a topic that gains a channel must re-read.
  */
  const key = useMemo(
    () =>
      (topics ?? [])
        .filter((topic) => topic.folderId)
        .map((topic) => `${topic.id}:${topic.folderId}`)
        .sort()
        .join(','),
    [topics],
  )
  const pairs = useMemo(
    () => (key ? key.split(',').map((entry) => entry.split(':') as [string, string]) : []),
    [key],
  )
  const channels = useMemo(() => [...new Set(pairs.map(([, folder]) => folder))], [pairs])

  // A slow read for a previous set must not paint over the current one. Set in
  // an effect, not during render (`react-hooks/refs`), and before `load`'s
  // effect below because effects run in declaration order.
  const current = useRef(key)
  useEffect(() => {
    current.current = key
  }, [key])

  const read = useCallback(async () => {
    const at = Math.floor(Date.now() / 1000)
    const streams = await channelStreams(channels)
    return { at, streams }
  }, [channels, channelStreams])

  const load = useCallback(() => {
    if (channels.length === 0) return
    const asked = key
    void read()
      .then((next) => current.current === asked && setHeld(next))
      // A failed read costs the dots, never the list — and it leaves the last
      // answer standing rather than blanking every row on one bad request.
      .catch(() => {})
  }, [channels, key, read])

  useEffect(() => {
    load()
  }, [load])

  useRefreshTriggers(load, { enabled: channels.length > 0 })

  return useMemo(() => {
    const unread: Record<string, boolean> = {}
    const urgent: Record<string, boolean> = {}
    // Not judged until the first merge has landed: before that every marker is
    // absent, and "absent" would light the whole sidebar.
    if (!frontier.ready) return { unread, urgent }
    const me = validToken()?.pubkey
    for (const [id, folder] of pairs) {
      const messages = held.streams[folder]
      // Not asked about, or not answered yet: no entry, so no dot either way.
      if (!messages) continue
      const flags = topicChannelFlags(folder, messages, {
        marker: frontier.marker,
        me,
        nowSeconds: held.at,
        horizonSeconds: PEEK_HORIZON_DAYS * 24 * 60 * 60,
        cachedMarker: cachedMarks?.[folder],
      })
      unread[id] = flags.unread
      urgent[id] = flags.urgent
    }
    return { unread, urgent }
  }, [held, frontier, pairs, cachedMarks])
}
