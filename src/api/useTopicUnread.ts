import { useMemo } from 'react'
import { validToken } from '@/auth/estivaId'
import { PEEK_HORIZON_DAYS } from '@/nostr/readState'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { topicChannelFlags } from './topicUnread'
import { useChannelStreams } from './useChannelStreams'

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
 * The same messages FOL-18 measured, for topic channels instead of team
 * Folders: every message inside the horizon, per channel, where
 * `unread.summary` walked every message in every topic and every reply on
 * every message to answer the same question.
 *
 * ## What it replaces, and what it does not
 *
 * Any channel's dot, not only a topic's: since REM-3 `useUnread` folds DMs
 * through this too, keyed by the partner's pubkey and read from the DM's
 * channel. Huddles are not channels and have been off since CON-8, and
 * `unread.summary`, which held them, is no longer asked.
 *
 * ## `undefined` is not "nothing new"
 *
 * A topic absent from the maps was not judged — no viewer, a read that failed,
 * a frontier that has not landed, or a topic with no channel — and a caller
 * draws no dot rather than a confident dark one. Same rule as FOL-18's, for
 * the same reason.
 *
 * ## It does not read (PER-8)
 *
 * It used to, on its own triggers, over a set that overlaps the team dots' —
 * two 90-day reads per socket signal, focus, visibility change and 30 s tick
 * between the two hooks. The messages now come from the tab's channel store
 * (`useChannelStreams`), shared with `useTeamUnread`, which reads a channel
 * once, applies what the socket delivers and catches up from a cursor. The
 * store keeps a catch-up on an interval underneath the socket, for the same
 * reason this hook once kept its own: a wide filter that the relay accepts and
 * never fans out is silent.
 *
 * Judging is separate and free: it re-runs on every frontier change without a
 * read, which is what turns a dot off the moment this tab records a read.
 */
export function useTopicUnread(
  topics: readonly TopicChannel[] | null | undefined,
  /**
   * A cached watermark per channel uuid, unix seconds. Raises the relay
   * marker, never lowers it; `topicUnread.ts` says why a fold might want it.
   * No caller passes one since REM-3 stopped reading `unread.summary`'s
   * `topicMarks`.
   */
  cachedMarks?: Readonly<Record<string, number>> | undefined,
): {
  unread: Record<string, boolean>
  urgent: Record<string, boolean>
} {
  const frontier = useReadFrontier()

  /*
    Keyed on the pairs, not the array: `useTopics` hands back a fresh array per
    render, and what the dots depend on is which topics are listed and which
    channel each reads from — a topic that gains a channel must be read.
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

  /*
    The clock is read with the messages, not while judging: the horizon is
    measured from `at`, and a render must not consult `Date.now()`.
  */
  const held = useChannelStreams(channels)

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
