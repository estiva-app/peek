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
import { URGENT_ITEMS } from '@/data/deskData'
import { useAvatarSrc } from './avatars'
import { useOpenWork } from './internal/openWork'
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

/**
 * Open work comes from the relay blob and Urgent from Convex (SHR-9).
 *
 * The asymmetry is ADR 0001 working rather than an inconsistency. Open work is
 * four fields a person authored, so it is layer 2 and `OpenWorkProvider` owns it
 * — rows, order, the optimistic window and the publish. Urgent is derived
 * server-side from every message in a container against the readState watermark
 * (§4.4): that is aggregation over data the viewer does not hold, which is
 * exactly what layer 3 is for.
 */
export function useDeskItems(): { openWork: OpenWorkItem[]; urgent: UrgentItem[] } {
  const avatarSrcFor = useAvatarSrc()
  const openWork = useOpenWork()
  const urgent = useQuery(api.desk.urgentList, hasConvex ? {} : 'skip')

  if (!hasConvex) return { openWork: openWork.items, urgent: URGENT_ITEMS }
  return {
    openWork: openWork.items,
    urgent: (urgent ?? []).map((u) => (u.kind === 'dm' ? { ...u, avatarSrc: avatarSrcFor(u.name) } : u)),
  }
}

/** Topic ids currently in Open work — drives the Add/Remove advertising in
 *  the topic menus and excludes already-added topics from the Desk picker.
 *
 *  Read off the *list*, not the rendered rows: a topic the workspace index has
 *  not delivered yet is still in Open work, and answering "no" for it would let
 *  the picker offer it again and add a second copy. */
export function useOpenWorkTopicIds(): Set<string> {
  return useOpenWork().topicIds
}

/** True while any Desk list is still unsettled (drives the sidebar skeleton). */
export function useDeskLoading(): boolean {
  const screener = useQuery(api.desk.screenerList, hasConvex ? {} : 'skip')
  const urgent = useQuery(api.desk.urgentList, hasConvex ? {} : 'skip')
  const openWorkLoading = useOpenWork().isLoading
  return hasConvex && (screener === undefined || urgent === undefined || openWorkLoading)
}
