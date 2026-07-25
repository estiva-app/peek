/**
 * Desk + Screener reads.
 *
 * Convex-backed when a deployment is configured: per-user tables for
 * screener items and open work (domain model §2.12–2.13), and the urgent
 * list fully derived server-side (§4.4 — urgent message or an unread reply
 * on one, newer than the readState watermark). Static mocks otherwise.
 * DM-partner avatars resolve through the shared registry (uploaded avatar,
 * else the seeded portrait).
 */
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { SCREENER_ITEMS } from '@/data/screenerData'
import { OPEN_WORK_ITEMS, URGENT_ITEMS } from '@/data/deskData'
import { useAvatarSrc } from './avatars'
import { useOpenWorkOverrides } from './internal/openWork'
import { useTopicLookup, useIsTopicResolved } from './topics'
import { hasConvex } from './store'
import type { ScreenerItem, OpenWorkItem, UrgentItem } from './types'

export function useScreenerItems(): ScreenerItem[] {
  const avatarSrcFor = useAvatarSrc()
  const remote = useQuery(api.desk.screenerList, hasConvex ? {} : 'skip')
  if (!hasConvex) return SCREENER_ITEMS
  return (remote ?? []).map((i) =>
    i.kind === 'dm' ? { ...i, authorAvatarSrc: avatarSrcFor(i.authorName) } : i,
  )
}

export function useDeskItems(): { openWork: OpenWorkItem[]; urgent: UrgentItem[] } {
  const avatarSrcFor = useAvatarSrc()
  const o = useOpenWorkOverrides()
  const findTopic = useTopicLookup()
  const isTopicResolved = useIsTopicResolved()
  const openWork = useQuery(api.desk.openWorkList, hasConvex ? {} : 'skip')
  const urgent = useQuery(api.desk.urgentList, hasConvex ? {} : 'skip')

  const base: OpenWorkItem[] = !hasConvex
    ? OPEN_WORK_ITEMS
    : (openWork ?? []).map((w) => (w.kind === 'dm' ? { ...w, avatarSrc: avatarSrcFor(w.name) } : w))

  // Session overlay (Desk "+" picker + the topic menus): removals hide rows,
  // additions prepend. In mock mode this IS the state; with Convex it covers
  // the optimistic window — rows the reactive query already returns are
  // skipped so nothing doubles up when it catches up.
  const kept = base.filter((w) => w.kind === 'dm' || !o.removedTopicIds.has(w.topicId))
  const presentTopicIds = new Set(kept.filter((w) => w.kind !== 'dm').map((w) => (w as { topicId: string }).topicId))
  const added: OpenWorkItem[] = [...o.addedTopicIds]
    .reverse() // newest addition first, matching the server's addedAt sort
    .filter((id) => !presentTopicIds.has(id) && !o.removedTopicIds.has(id))
    .flatMap((id) => {
      const topic = findTopic(id)
      if (!topic) return []
      return [{
        id: `ow_rt_${id}`,
        kind: 'topic' as const,
        topicId: id,
        title: topic.title,
        topicStatus: isTopicResolved(id) ? ('resolved' as const) : ('unresolved' as const),
      }]
    })
  const merged = [...added, ...kept]

  if (!hasConvex) return { openWork: merged, urgent: URGENT_ITEMS }
  return {
    openWork: merged,
    urgent: (urgent ?? []).map((u) => (u.kind === 'dm' ? { ...u, avatarSrc: avatarSrcFor(u.name) } : u)),
  }
}

/** Topic ids currently in Open work — drives the Add/Remove advertising in
 *  the topic menus and excludes already-added topics from the Desk picker. */
export function useOpenWorkTopicIds(): Set<string> {
  const { openWork } = useDeskItems()
  return new Set(openWork.filter((w) => w.kind !== 'dm').map((w) => (w as { topicId: string }).topicId))
}

/** True while any Desk list query is in flight (drives the sidebar skeleton). */
export function useDeskLoading(): boolean {
  const screener = useQuery(api.desk.screenerList, hasConvex ? {} : 'skip')
  const openWork = useQuery(api.desk.openWorkList, hasConvex ? {} : 'skip')
  const urgent = useQuery(api.desk.urgentList, hasConvex ? {} : 'skip')
  return hasConvex && (screener === undefined || openWork === undefined || urgent === undefined)
}
