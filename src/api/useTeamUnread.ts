import { useEffect, useMemo, useRef } from 'react'
import type { FolderSummary } from '@estiva-app/interop'
import { useMembership } from '@/api'
import { validToken } from '@/auth/estivaId'
import { useLiveClient } from '@/nostr/useLiveClient'
import { relayFailureKind } from '@/nostr/relayRead'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { type TeamUnreadProbe, type TeamUnreadTrigger, teamUnreadProbe } from './teamUnreadDiagnostic'
import { placeStreams, teamHasMemberStream, teamHasUnread, unlistedFiles } from './teamUnread'
import { onChannelStoreDelivery, onChannelStoreRead, useChannelStreams } from './useChannelStreams'
import { useFileParents } from './useFileParents'

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
 * Whether anything in each Folder is new to the viewer — SPEC §11.3, FOL-18.
 *
 * It draws no dot: a Folder row carries none, only its files do (Miky,
 * 2026-10-03). It is what the tree's Unread filter keeps (FOL-41). It is the
 * union of the Folder's streams, judged by
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
 * read — what turns the dot off when this tab records a file as read.
 */
export function useTeamUnread(folders: readonly FolderSummary[] | null | undefined): {
  unread: Record<string, boolean>
  /**
   * Whether each Folder holds a file the person is a member of — the Topics
   * view (FOL-41, CON-19): one its state lists, one talked about in it, or an
   * unlisted one whose parent it lists. Missing means not theirs, or not
   * judged yet — `ready.member` says which.
   */
  member: Record<string, boolean>
  /**
   * The parents of joined files no state lists — a project, for an issue of
   * yours — so Topics keeps that row though the file is not in the listing.
   */
  holdsJoined: ReadonlySet<string>
  /**
   * The same files, by the parent that holds them: a project's address, and
   * the issues of yours under it. Topics draws them as rows of their own,
   * flat (Katerina, 7 October), where only the parent was before.
   */
  joinedUnder: Readonly<Record<string, readonly string[]>>
  /** Whether `member` and `unread` have been judged yet: a filter waits for its own. */
  ready: { member: boolean; unread: boolean }
} {
  const frontier = useReadFrontier()
  const membership = useMembership()
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
    The store's reads and deliveries, told to the probe in its own words. A
    read is reported once it is over, so `loadStarted` and `loadSettled` arrive
    together; what the probe keeps is the trigger and the outcome, and both are
    still true. A delivery for a Folder this sidebar does not list is another
    reader's. The rows inside an open section no longer need a signal from
    here: their badges fold what the store holds (OPT-5).
  */
  useEffect(() => {
    const listed = new Set(ids)
    const unread = onChannelStoreRead((read) => {
      probe.current?.loadStarted(triggerOf(read.reason))
      probe.current?.loadSettled(
        read.outcome,
        read.outcome === 'ok' ? { answered: read.channels } : { failure: relayFailureKind(read.error) },
      )
    })
    const undelivered = onChannelStoreDelivery((folder) => {
      if (listed.has(folder)) probe.current?.delivered(folder)
    })
    return () => {
      unread()
      undelivered()
    }
  }, [ids])

  /*
    A moved file's talk is judged in the Folder that lists it now (FOL-49), and
    a file no state lists — an issue — where its parent is listed (FOL-50).
    Until a parent is known the file stays where it is talked about.
  */
  const unlisted = useMemo(() => unlistedFiles(held.streams, folders ?? []), [held, folders])
  /*
    And every file the person joined that no state lists — an issue, listed
    through its project — whether or not anyone has talked in it: Topics is
    all of what they joined (Katerina, 5 October), and the parent is where it
    is drawn. The same read, the same cache: one more address per such file.
  */
  const listedAnywhere = useMemo(
    () => new Set((folders ?? []).flatMap((folder) => (folder.hasState ? (folder.addresses ?? []) : []))),
    [folders],
  )
  const joinedUnlisted = useMemo(
    () => membership.memberFiles.filter((address) => !listedAnywhere.has(address)),
    [membership.memberFiles, listedAnywhere],
  )
  const asked = useMemo(() => [...unlisted, ...joinedUnlisted], [unlisted, joinedUnlisted])
  const parents = useFileParents(asked)
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
    const memberIn: Record<string, boolean> = {}
    // Not judged until the first merge has landed: before that every marker is
    // absent, and "absent" would light the whole sidebar. Nor until the relay
    // has said what the person is a member of (§11.8): an unknown set is not
    // an empty one, and judging over it would put every dot out and then relight.
    if (!frontier.ready || membership.state === 'unknown') return { unread, member: memberIn }
    const me = validToken()?.pubkey
    for (const folder of ids) {
      const messages = placed.streams[folder]
      memberIn[folder] = teamHasMemberStream(messages ?? [], membership.isMember)
      // Not asked about, or not answered yet: no entry, so no dot either way.
      if (!messages) continue
      unread[folder] = teamHasUnread(folder, messages, {
        merged: frontier.merged,
        termsOf: membership.termsOf,
        isMentioned: membership.isMentioned,
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
        a channel of its own placed in its team, so a team that holds a topic
        the person is on holds something of theirs, exactly as it holds
        something unread. Only a confident "yes" travels.
      */
      for (const container of folder.listedIn) {
        if (unread[folder.id]) unread[container] = true
        if (memberIn[folder.id]) memberIn[container] = true
      }
    }
    return { unread, member: memberIn }
  }, [placed, frontier, membership.state, membership.isMember, membership.termsOf, membership.isMentioned, ids, folders])

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
      merged: frontier.merged,
      membership: membership.state,
      termsOf: membership.termsOf,
      isMentioned: membership.isMentioned,
      me: validToken()?.pubkey,
      held: { at: placed.at, streams: placed.streams },
      horizonSeconds: HORIZON_SECONDS,
      result: judged,
    })
  }, [ids, folders, live, relayState, frontier, membership.state, membership.termsOf, membership.isMentioned, placed, judged])

  /*
    Topics from what the person joined, not only from what was said (Katerina,
    5 October): the streams above see a joined file only once somebody talks
    in it inside the horizon, so a quiet file, or a topic just started, was
    missing. A Folder is theirs when its state lists a file they are a member
    of — joined, or made by them — or the parent of a joined file no state
    lists; and a Folder listed inside another makes that one theirs, as above.
  */
  const { state: membershipState, isMember } = membership
  const mine = useMemo(() => {
    const member = { ...judged.member }
    const holdsJoined = new Set<string>()
    const joinedUnder: Record<string, string[]> = {}
    if (membershipState === 'unknown') return { member, holdsJoined, joinedUnder }
    for (const address of joinedUnlisted) {
      const parent = parents[address]
      if (!parent) continue
      holdsJoined.add(parent)
      ;(joinedUnder[parent] ??= []).push(address)
    }
    for (const folder of folders ?? []) {
      if (folder.hasState && folder.addresses?.some((address) => holdsJoined.has(address) || isMember(address))) {
        member[folder.id] = true
      }
    }
    for (const folder of folders ?? []) {
      if (!member[folder.id] || !folder.listedIn) continue
      for (const container of folder.listedIn) member[container] = true
    }
    return { member, holdsJoined, joinedUnder }
  }, [judged.member, membershipState, isMember, joinedUnlisted, parents, folders])

  /*
    Whether each verdict has been judged yet: Topics waits for membership, and
    Unread for the read state too. Until then a filtered column is a skeleton,
    not "Nothing yours yet".
  */
  const ready = useMemo(
    () => ({ member: membership.state !== 'unknown', unread: membership.state !== 'unknown' && frontier.ready }),
    [membership.state, frontier.ready],
  )

  return useMemo(
    () => ({ unread: judged.unread, member: mine.member, holdsJoined: mine.holdsJoined, joinedUnder: mine.joinedUnder, ready }),
    [judged.unread, mine, ready],
  )
}
