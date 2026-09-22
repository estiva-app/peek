import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForeignObjects } from '@/api/foreign'
import { validToken } from '@/auth/estivaId'
import type { StreamMessage } from '@/nostr/channelStreams'
import { useLiveTopics } from '@/nostr/useLiveTopics'
import { relayLog } from '@/nostr/liveTopics'
import { relayFailureKind, withRateLimitRetry } from '@/nostr/relayRead'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { topicChannelFlags } from './topicUnread'

/** How long the socket's activity is gathered before one re-read pays for all of it. */
export const TOPIC_UNREAD_SETTLE_MS = 1_000

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
 * On the set of topics changing, on the socket reporting something said in any
 * of them — gathered for a moment, so a burst of messages is one read rather
 * than one each — and on the refresh triggers as the fallback.
 *
 * The socket path is `watchChannels`, **not** the `onForeignActivity` one
 * `useTeamUnread` uses: that fires for events the projection did *not* take,
 * and a topic's own `kind:9` is exactly what it takes, so it never fires for
 * this question. `watchChannels` is the client's wide filter — one REQ for the
 * whole sidebar, told which channel changed.
 *
 * **The interval stays on underneath it**, which is not belt-and-braces. A
 * wide filter fans out only on a relay build carrying the plural
 * `extract_channel_ids_from_filters`; against the singular one the REQ is
 * accepted and delivers nothing, with no error to notice. So the socket makes
 * this instant where it works and the 30 s fallback is what it degrades to,
 * rather than the dots going quiet on a relay nobody thought to check.
 *
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
    Acquired, not borrowed (FOL-40): the topics column mounts before anything
    that builds the socket, and `peekLiveTopics()` answers null until one
    exists — so this subscription was made only when something else had
    already connected. Same defect as the team dot's, found with it.
  */
  const { live, relayState } = useLiveTopics()

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

  /*
    Waits out a quota refusal at the second the relay named, rather than
    dropping it (FOL-40) — the same wrapper the team dot's read has, for the
    same reason: this re-read goes out a second after somebody spoke, which is
    when every other client is asking too.
  */
  const read = useCallback(
    () =>
      withRateLimitRetry(async () => {
        const at = Math.floor(Date.now() / 1000)
        const streams = await channelStreams(channels)
        return { at, streams }
      }),
    [channels, channelStreams],
  )

  const load = useCallback(() => {
    if (channels.length === 0) return
    const asked = key
    void read()
      .then((next) => current.current === asked && setHeld(next))
      // A failed read costs the dots, never the list — and it leaves the last
      // answer standing rather than blanking every row on one bad request.
      // Loud only for a quota refusal that outlived its retries (FOL-40).
      .catch((error: unknown) =>
        relayLog(
          relayFailureKind(error) === 'rate_limited'
            ? 'topic unread giving up after waiting out the quota'
            : 'topic unread read failed',
          error,
        ),
      )
  }, [channels, key, read])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!live || channels.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        load()
      }, TOPIC_UNREAD_SETTLE_MS)
    }
    const watch = live.watchChannels(channels, settle)
    return () => {
      if (timer) clearTimeout(timer)
      watch.stop()
    }
  }, [live, channels, load])

  /* Connecting is not watching: the transition into live is a re-read. */
  const wasLive = useRef(relayState === 'live')
  useEffect(() => {
    if (relayState === 'live' && !wasLive.current) load()
    wasLive.current = relayState === 'live'
  }, [relayState, load])

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
