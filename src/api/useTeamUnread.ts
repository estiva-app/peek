import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FolderSummary } from '@estiva-app/interop'
import { useFollows } from '@/api'
import { validToken } from '@/auth/estivaId'
import { useLiveClient } from '@/nostr/useLiveClient'
import { relayFailureKind } from '@/nostr/relayRead'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { type TeamUnreadProbe, type TeamUnreadTrigger, teamUnreadProbe } from './teamUnreadDiagnostic'
import { placeStreams, teamHasFollowedStream, teamHasUnread, unlistedFiles } from './teamUnread'
import { onChannelStoreDelivery, onChannelStoreRead, useChannelStreams } from './useChannelStreams'
import { useFileParents } from './useFileParents'

/** How long the socket's activity is gathered before an open section is told once (FOL-44). */
export const TEAM_UNREAD_SETTLE_MS = 1_000

/** What asked the store to read, in the words the probe has always used. */
function triggerOf(reason: string): TeamUnreadTrigger {
  if (reason === 'track') return 'folders'
  if (reason === 'signal') return 'socket'
  if (reason === 'relay-live') return 'relay-live'
  return 'refresh'
}

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
 * ## It does not read (PER-8)
 *
 * It used to: 90 days of every listed Folder on every socket signal, focus,
 * visibility change and 30 s tick, beside `useTopicUnread` doing the same for
 * an overlapping set — which is how an ordinary page load spent the relay's
 * per-request quota. The messages now come from the tab's channel store
 * (`useChannelStreams`), which reads a Folder once, applies what the socket
 * delivers, and catches up from a cursor; that file has the cadence. What is
 * left here is the judging, which runs on every frontier change without a
 * read — what turns the dot off when this tab records a file as read — and
 * the socket's signal handed on to the rows (`activity`, FOL-44).
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
  /**
   * How many times the socket has reported something said in each Folder, or
   * in a Folder it lists — a number that changes, for an open section's rows
   * to re-read their dots on (FOL-44). See `activity` below.
   */
  activity: Record<string, number>
} {
  const frontier = useReadFrontier()
  const follows = useFollows()
  // For the probe only: the store holds the socket now, and this says what it is doing.
  const { live, relayState } = useLiveClient()

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

  /*
    The clock is read with the messages, not while judging: the horizon is
    measured from `at`, and a render must not consult `Date.now()` — the judge
    runs pure, and a boundary ninety days back does not move between reads.
  */
  const held = useChannelStreams(ids)

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
    Which Folders the socket said something about, counted per settle window
    (FOL-44). The dot follows the store, and the rows inside an open section
    do not: their badges are one read keyed on the listing's addresses, so a
    comment changed nothing they depend on and the dot waited for the section
    to be closed and opened again. This is the signal handed on — no second
    subscription, and gathered in a window, so a subscribe's replay of stored
    events is one re-read per open section rather than one per event.
  */
  const [signalled, setSignalled] = useState<Record<string, number>>({})
  const bump = useCallback((touched: Iterable<string>) => {
    setSignalled((before) => {
      const next = { ...before }
      for (const folder of touched) next[folder] = (next[folder] ?? 0) + 1
      return next
    })
  }, [])

  /*
    The store's reads and deliveries, told to the probe in its own words and
    handed on as `activity`. A read is reported once it is over, so
    `loadStarted` and `loadSettled` arrive together; what the probe keeps is
    the trigger and the outcome, and both are still true. A delivery for a
    Folder this sidebar does not list is another reader's.
  */
  useEffect(() => {
    const listed = new Set(ids)
    const touched = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const unread = onChannelStoreRead((read) => {
      probe.current?.loadStarted(triggerOf(read.reason))
      probe.current?.loadSettled(
        read.outcome,
        read.outcome === 'ok' ? { answered: read.channels } : { failure: relayFailureKind(read.error) },
      )
      // A socket back from being down may have missed anything, anywhere.
      if (read.reason === 'relay-live' && read.outcome === 'ok') bump(ids)
    })
    const undelivered = onChannelStoreDelivery((folder) => {
      if (!listed.has(folder)) return
      probe.current?.delivered(folder)
      touched.add(folder)
      /*
        A ceiling, not a debounce (FOL-40): the window opens on the first
        signal and a later one never pushes it back, because a subscribe or a
        reconnect replays stored events in a continuous run.
      */
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        bump([...touched])
        touched.clear()
      }, TEAM_UNREAD_SETTLE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      unread()
      undelivered()
    }
  }, [ids, bump])

  /*
    A moved file's talk is judged in the Folder that lists it now (FOL-49), and
    a file no state lists — an issue — where its parent is listed (FOL-50).
    Until a parent is known the file stays where it is talked about.
  */
  const unlisted = useMemo(() => unlistedFiles(held.streams, folders ?? []), [held, folders])
  const parents = useFileParents(unlisted)
  const placed = useMemo(
    () => ({ at: held.at, ...placeStreams(held.streams, folders ?? [], parents) }),
    [held, folders, parents],
  )

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
      const messages = placed.streams[folder]
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
        nowSeconds: placed.at,
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
  }, [placed, frontier, follows.state, follows.isFollowed, ids, folders])

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
      held: { at: placed.at, streams: placed.streams },
      horizonSeconds: HORIZON_SECONDS,
      result: judged,
    })
  }, [ids, folders, live, relayState, frontier, follows.state, follows.isFollowed, placed, judged])

  /*
    A topic or a project's conversation channel is a Folder of its own placed
    in its team (FOL-22, FOL-42), and the section drawn is the team's — so a
    signal travels to every container that lists it, exactly as the dot does
    above. Summed, so the container's number changes whichever of its streams
    spoke.
  */
  const activity = useMemo(() => {
    const out: Record<string, number> = { ...signalled }
    for (const folder of folders ?? []) {
      const own = signalled[folder.id]
      if (!own || !folder.listedIn) continue
      for (const container of folder.listedIn) out[container] = (out[container] ?? 0) + own
    }
    // And to wherever a moved file's talk in it is judged (FOL-49).
    for (const [from, into] of Object.entries(placed.handed)) {
      const own = signalled[from]
      if (!own) continue
      for (const container of into) out[container] = (out[container] ?? 0) + own
    }
    return out
  }, [signalled, folders, placed.handed])

  return useMemo(() => ({ ...judged, activity }), [judged, activity])
}
