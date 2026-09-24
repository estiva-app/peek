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
import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { URGENT_ITEMS } from '@/data/deskData'
import { useAvatarSrc } from './avatars'
import { useOpenWork, useOpenWorkIfMounted } from './internal/openWork'
import { useScreener } from './internal/screener'
import { hasConvex } from './store'
import type { ScreenerItem, OpenWorkItem, UrgentItem } from './types'

/**
 * The Screener's rows. The topic half is folded on the device (SHR-10), the DM
 * half still comes from Convex, and `ScreenerProvider` merges the two — see its
 * header for why rule 1 cannot be folded until DMS-3.
 */
export function useScreenerItems(): ScreenerItem[] {
  return useScreener().items
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
    urgent: (urgent ?? []).map((u) => ({ ...u, avatarSrc: avatarSrcFor(u.name) })),
  }
}

/** Which files are in Open work, and the toggle — FOL-34. */
export interface OpenWorkFiles {
  /** File addresses in the list, read off the list rather than the rendered
   *  rows: a file the relay has not resolved yet is still in Open work. */
  has: (address: string) => boolean
  add: (address: string) => void
  remove: (address: string) => void
}

const NO_FILES = new Set<string>()
const INERT_FILES: OpenWorkFiles = { has: () => false, add: () => {}, remove: () => {} }

/**
 * Open work for files — the file page's and the tree row's Add/Remove (FOL-34).
 *
 * Its own seam, like `useFollows`, rather than two more `usePeekActions` verbs:
 * the list is the relay's alone (no Convex dual-write for a file), and a tree
 * row mounted without the provider — a story, a test — gets an inert value
 * instead of a throw, so the row can still be drawn on its own.
 */
export function useOpenWorkFiles(): OpenWorkFiles {
  const openWork = useOpenWorkIfMounted()
  const addresses = openWork?.fileAddresses ?? NO_FILES
  const add = openWork?.addFile
  const remove = openWork?.removeFile
  return useMemo(
    () => (add && remove ? { has: (a: string) => addresses.has(a), add, remove } : INERT_FILES),
    [addresses, add, remove],
  )
}

/** True while any Desk list is still unsettled (drives the sidebar skeleton). */
export function useDeskLoading(): boolean {
  const urgent = useQuery(api.desk.urgentList, hasConvex ? {} : 'skip')
  const openWorkLoading = useOpenWork().isLoading
  // The Screener's own loading now covers the relay's answer as well as the two
  // Convex reads: the decisions blob is subtractive, so rendering before it
  // arrives shows rows the person has already dismissed.
  const screenerLoading = useScreener().isLoading
  return hasConvex && (screenerLoading || urgent === undefined || openWorkLoading)
}
