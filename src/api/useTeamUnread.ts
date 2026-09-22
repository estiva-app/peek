import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FolderSummary } from '@estiva-app/interop'
import { KIND } from '@estiva-app/protocol'
import { useFollows, useForeignObjects } from '@/api'
import { validToken } from '@/auth/estivaId'
import type { StreamMessage } from '@/nostr/channelStreams'
import { useLiveTopics } from '@/nostr/useLiveTopics'
import { relayLog } from '@/nostr/liveTopics'
import { relayFailureKind, withRateLimitRetry } from '@/nostr/relayRead'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { type TeamUnreadProbe, type TeamUnreadTrigger, teamUnreadProbe } from './teamUnreadDiagnostic'
import { teamHasFollowedStream, teamHasUnread } from './teamUnread'

/** How long the socket's activity is gathered before one re-read pays for all of it. */
export const TEAM_UNREAD_SETTLE_MS = 1_000

/** §11.6's absent-marker horizon, in seconds — the judge's and the probe's. */
const HORIZON_SECONDS = PEEK_HORIZON_DAYS * 24 * 60 * 60

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
 * On the set of Folders changing, on the socket reporting something said in
 * any of them (`watchChannels`, the wide `#h` filter — FOL-40) — gathered for
 * a moment, so a burst of comments is one read rather than one each — and on
 * the refresh triggers as the fallback the socket does not cover, exactly as
 * the Folder view keeps its own listing fresh. The judging
 * is separate and cheaper: it runs on every frontier change without a read,
 * which is what turns the dot off when this tab records a file as read.
 */
export function useTeamUnread(folders: readonly FolderSummary[] | null | undefined): {
  unread: Record<string, boolean>
  /**
   * Whether each Folder holds a stream the person follows — the tree's
   * `Followed` filter (FOL-41), judged over the messages already read for the
   * dots. Same rule about absence as `unread`: a Folder with no entry was not
   * judged, and a filter keeps it rather than hiding it on a guess.
   */
  followed: Record<string, boolean>
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
  const follows = useFollows()
  /*
    Acquired, not borrowed (FOL-40). `peekLiveTopics()` answers null until
    something else has built the socket, and the sidebar is usually the first
    thing in the tab that wants one — see `useLiveTopics`.
  */
  const { live, relayState } = useLiveTopics()

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

  /*
    The console's view of this mount (FOL-40). Opened before the effects that
    write to it — effects run in declaration order — and closed on unmount, so
    a snapshot never reports a hook that is no longer on screen. Every call
    below is optional-chained: the probe does not exist during the first
    render, and nothing here is allowed to be the reason a dot fails.
  */
  const probe = useRef<TeamUnreadProbe | undefined>(undefined)
  useEffect(() => {
    const opened = teamUnreadProbe()
    probe.current = opened
    return () => {
      opened.stop()
      probe.current = undefined
    }
  }, [])

  /*
    Wrapped, because the live re-read is the one read in the app most likely to
    be refused (FOL-40): it goes out a second after somebody said something,
    which is a second after *their* client and every other tab did the same
    work, and the relay's per-minute quota is per person. `withRateLimitRetry`
    waits out the window at the second the relay named and asks again; anything
    else throws on the first attempt, as before.
  */
  const read = useCallback(
    () =>
      withRateLimitRetry(async () => {
        const at = Math.floor(Date.now() / 1000)
        const streams = await channelStreams(ids)
        return { at, streams }
      }),
    [ids, channelStreams],
  )

  const load = useCallback(
    (trigger: TeamUnreadTrigger) => {
      // Nothing to ask about. What is held is not cleared — the judge below only
      // looks up the Folders currently listed, so a stale entry is never drawn.
      if (ids.length === 0) return
      const asked = key
      probe.current?.loadStarted(trigger)
      void read()
        .then((next) => {
          probe.current?.loadSettled('ok', { answered: Object.keys(next.streams).length })
          return current.current === asked && setHeld(next)
        })
      // A failed read costs the dots, never the list — and it leaves the last
      // answer standing rather than blanking every row on one bad request.
      // Swallowed, but no longer in silence (FOL-40): a quota refusal that
      // outlived its retries is a live path that has stopped, and that is
      // worth a warning. An unreachable relay on a 30 s tick is the ordinary
      // offline case and stays at debug, where it has always been.
        .catch((error: unknown) => {
          const failure = relayFailureKind(error)
          probe.current?.loadSettled('failed', { failure })
          relayLog(
            failure === 'rate_limited'
              ? 'team unread giving up after waiting out the quota'
              : 'team unread read failed',
            error,
          )
        })
    },
    [ids, key, read],
  )

  useEffect(() => {
    load('folders')
  }, [load])

  useEffect(() => {
    if (!live || ids.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (folder: string) => {
      // Counted whether or not it schedules a read: `deliveries` beside
      // `loads` is what measured the flood below in the first place.
      probe.current?.delivered(folder)
      /*
        The window opens on the first signal and is never pushed back by a
        later one (FOL-40). Restarting it is the ordinary debounce, and it is
        wrong here: the wide filter's listener fires for the relay's **stored**
        events as well as live ones — one production tab reported
        `deliveries: 1081` on an 81-Folder watch where `__wideFilters()`
        counted 1,078 of them as backfill — so a subscribe or a reconnect
        delivers a continuous run of them, each one pushing the read further
        away. The same tab measured the result: the last signal at 17:12:50 and
        the next read at 17:13:09, nineteen seconds later, carrying
        `trigger: 'refresh'`. The socket had done its job and the 30-second
        fallback still got there first.

        So this is a ceiling, not a delay: at most one read per window, the
        first signal in a burst is served within it, and a flood costs one read
        per window rather than none. That is what the doc above has always
        claimed — "a burst of comments is one read rather than one each".
      */
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        load('socket')
      }, TEAM_UNREAD_SETTLE_MS)
    }
    /*
      The wide filter, not `onForeignActivity` (FOL-40). That signal is fed by
      the projection and reports only what it did *not* take — a Ship issue
      moved, a record changed — never a `kind:9` or `kind:1111`, which it
      consumes as messages. So the socket never told the dot that somebody
      commented; only the refresh triggers did, a focus or the 30 s tick, and
      the dot arrived on the same tick as every listing's re-read. This is the
      same subscription `useTopicUnread` holds, one REQ per 128 Folders, told
      which Folder said something and nothing else — so the re-read stays.
    */
    const watch = live.watchChannels(ids, settle, { kinds: [KIND.STREAM_MESSAGE, KIND.COMMENT] })
    return () => {
      if (timer) clearTimeout(timer)
      watch.stop()
    }
  }, [live, ids, load])

  /*
    Connecting is not watching. A socket that goes live after the subscription
    was made delivers nothing about what was said while it was down, so the
    transition itself is a re-read — the same thing `useLiveFile` does, and the
    reason a dot is not stale for thirty seconds after a laptop wakes.
  */
  const wasLive = useRef(relayState === 'live')
  useEffect(() => {
    if (relayState === 'live' && !wasLive.current) load('relay-live')
    wasLive.current = relayState === 'live'
  }, [relayState, load])

  useRefreshTriggers(() => load('refresh'), { enabled: ids.length > 0 })

  /*
    Judged on every frontier change, not only when the messages arrive — the
    frontier moves when this tab records a read, and that is what turns a dot
    off. A listing's worth of messages against a map lookup each.
  */
  const judged = useMemo(() => {
    const unread: Record<string, boolean> = {}
    const followedIn: Record<string, boolean> = {}
    // Not judged until the first merge has landed: before that every marker is
    // absent, and "absent" would light the whole sidebar. Nor until the relay
    // has said what the person follows (FOL-30): an unknown set is not an
    // empty one, and judging over it would put every dot out and then relight.
    if (!frontier.ready || follows.state === 'unknown') return { unread, followed: followedIn }
    const me = validToken()?.pubkey
    for (const folder of ids) {
      const messages = held.streams[folder]
      /*
        Judged before the messages are, because half of it does not need them:
        following the Folder follows its general chat, and a Folder nobody has
        said anything in still answers "yes" to that. `teamHasUnread` below is
        the opposite — with nothing said there is nothing unread — so it keeps
        the entry-or-nothing rule and an unasked Folder draws no dot.
      */
      followedIn[folder] = teamHasFollowedStream(folder, messages ?? [], follows.isFollowed)
      // Not asked about, or not answered yet: no entry, so no dot either way.
      if (!messages) continue
      unread[folder] = teamHasUnread(folder, messages, {
        marker: frontier.marker,
        followed: follows.isFollowed,
        me,
        nowSeconds: held.at,
        horizonSeconds: HORIZON_SECONDS,
      })
    }
    /*
      A Folder listed inside another is one of that team's streams (FOL-22): a
      topic is a channel of its own, placed in its team by address, and its
      messages carry the topic's `h`, not the team's — so the team's own stream
      says nothing about it. Its verdict is folded into every container that
      lists it. Only a confident "yes" travels: a topic judged read leaves the
      team's entry as it was, and a topic not judged says nothing.
    */
    for (const folder of folders ?? []) {
      if (!folder.listedIn) continue
      /*
        The same travel for both verdicts, and for the same reason: a topic is
        a channel of its own placed in its team, so a team that holds a
        followed topic holds something followed, exactly as it holds something
        unread. Only a confident "yes" travels.
      */
      for (const container of folder.listedIn) {
        if (unread[folder.id]) unread[container] = true
        if (followedIn[folder.id]) followedIn[container] = true
      }
    }
    return { unread, followed: followedIn }
  }, [held, frontier, follows.state, follows.isFollowed, ids, folders])

  /*
    Handed over after the commit, not during the render that produced it: the
    probe holds the values, and reading them from a console call is what makes
    a gate that lives for one render answerable minutes later.
  */
  useEffect(() => {
    probe.current?.observe({
      ids,
      folders: folders ?? [],
      live: Boolean(live),
      relayState,
      frontierReady: frontier.ready,
      marker: frontier.marker,
      follows: follows.state,
      isFollowed: follows.isFollowed,
      me: validToken()?.pubkey,
      held,
      horizonSeconds: HORIZON_SECONDS,
      result: judged,
    })
  }, [ids, folders, live, relayState, frontier, follows.state, follows.isFollowed, held, judged])

  return judged
}
