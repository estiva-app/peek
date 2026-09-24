/**
 * The channels the live working set watches, computed in the browser (REM-4).
 *
 * This was `api.nostr.sync.watchableChannels`, which read `screenerItems`,
 * `deskOpenWork` and `stars` from Convex — the whole reason stars and open work
 * stayed dual-written after their blobs became the truth. The three inputs are
 * already here: the Screener's rows, the open-work list and the starred set,
 * each read from the relay (or, for the Screener's topic and DM halves, from
 * wherever `ScreenerProvider` still folds them until CON-14).
 *
 * Same rules as the query it replaces. Order is priority — the Screener, then
 * open work, then stars — and a container that appears twice keeps its first
 * place. One channel is one subscription. At most {@link WORKING_SET_LIMIT}.
 *
 * ## What resolves a channel
 *
 * - **A topic** by the workspace index's `folderId`, else the `channelUuid` its
 *   open-work entry carries — the relay identity SHR-9 stored beside the id for
 *   exactly this, so a topic the index has not delivered is still watched.
 * - **A DM** by its partner's pubkey, through the relay's DM list
 *   (`useDmChannels`). A Screener DM row still names its partner by Convex key
 *   until CON-14, so it resolves to nothing here and is skipped; a DM nobody has
 *   opened has no channel yet, and is skipped as it always was.
 *
 * ## Not files, and not follows
 *
 * The ticket named follows as an input. Everything a person follows is a file,
 * and a file is already live: the channel store (`useChannelStreams`) watches
 * every followed Folder for the team dots, and `useLiveFile` watches the open
 * one. `live.watch` is the Convex container projection, and a file has no
 * container to project into — a file's conversation never enters Convex.
 */
import { useMemo } from 'react'
import { isPersonKey } from '@/api/people'
import { useTopics } from '@/api/topics'
import { useStarred } from './starred'
import { useOpenWork } from './openWork'
import { useScreener } from './screener'
import { useDmChannels } from './dms'

/** The ceiling `watchableChannels` held (`convex/nostr/sync.ts`). */
export const WORKING_SET_LIMIT = 32

export interface WorkingSetChannel {
  containerKind: 'topic' | 'dm'
  /** A topic's id, or a DM partner's pubkey. */
  containerKey: string
  channelUuid: string
}

type Wanted = { kind: 'topic'; id: string; channelUuid?: string } | { kind: 'dm'; key: string }

export function useWorkingSetChannels(): WorkingSetChannel[] {
  const screener = useScreener()
  const openWork = useOpenWork()
  const starred = useStarred()
  const topics = useTopics()
  const { channelOf } = useDmChannels()

  return useMemo(() => {
    const wanted: Wanted[] = []
    for (const row of screener.items) {
      if (row.kind === 'topic') wanted.push({ kind: 'topic', id: row.topicId })
      else if (row.kind === 'dm') wanted.push({ kind: 'dm', key: row.dmId })
    }
    for (const entry of openWork.entries) {
      if (entry.kind === 'topic') wanted.push({ kind: 'topic', id: entry.id, channelUuid: entry.channelUuid })
      else if (entry.kind === 'dm') wanted.push({ kind: 'dm', key: entry.key })
    }
    for (const id of starred.set?.topics ?? []) wanted.push({ kind: 'topic', id })
    for (const key of starred.set?.people ?? []) wanted.push({ kind: 'dm', key })

    const folderOf = new Map((topics ?? []).flatMap((t) => (t.folderId ? [[t.id, t.folderId] as const] : [])))
    // A topic's own channel beats one only a later input carries: the index
    // is current, and a blob's `channelUuid` is what the index said last time.
    const carried = new Map<string, string>()
    for (const w of wanted) {
      if (w.kind === 'topic' && w.channelUuid && !carried.has(w.id)) carried.set(w.id, w.channelUuid)
    }

    const channels: WorkingSetChannel[] = []
    const seen = new Set<string>()
    for (const w of wanted) {
      const containerKey = w.kind === 'topic' ? w.id : w.key
      const channelUuid =
        w.kind === 'topic'
          ? (folderOf.get(w.id) ?? carried.get(w.id))
          : isPersonKey(w.key)
            ? channelOf(w.key)
            : undefined
      // No channel: a topic from before Nostr emission, a DM nobody has
      // opened, or a Screener DM row still keyed by Convex. Nothing to watch.
      if (!channelUuid || seen.has(channelUuid)) continue
      seen.add(channelUuid)
      channels.push({ containerKind: w.kind, containerKey, channelUuid })
      if (channels.length >= WORKING_SET_LIMIT) break
    }
    return channels
  }, [screener.items, openWork.entries, starred.set, topics, channelOf])
}
