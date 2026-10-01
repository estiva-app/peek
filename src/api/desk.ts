/**
 * Desk + Screener reads — all of them from the relay since CON-14.
 *
 * The Screener and open work are their providers'; Urgent is the DM dots'
 * urgent flag (§4.4), read off the same fold. Static mocks without a relay.
 */
import { useMemo } from 'react'
import { URGENT_ITEMS } from '@/data/deskData'
import { useOpenWork, useOpenWorkIfMounted } from './internal/openWork'
import { useScreener } from './internal/screener'
import { useDmChannels } from './internal/dms'
import { useWorkspacePeople } from './people'
import { useUnread } from './unread'
import { hasRelay } from './relayUrl'
import type { ScreenerItem, OpenWorkItem, UrgentItem } from './types'

/** The Screener's rows — both halves folded from the relay by `ScreenerProvider`. */
export function useScreenerItems(): ScreenerItem[] {
  return useScreener().items
}

/**
 * Open work from the relay blob, and Urgent from the relay's DM channels (CON-14).
 *
 * Urgent used to be `desk.urgentList`, which walked every message and reply in
 * every DM on the server against Convex's readState watermark — the reason SHR-9
 * gave for leaving it there. The walk was already being done on the device: the
 * sidebar's urgent indicator is `useUnread().dmIsUrgent`, the channel fold over
 * every DM channel's messages against the NIP-RS markers, with the same rule
 * (an unread urgent message or reply by somebody else, per message — ruling
 * 2026-07-16). So Urgent is that flag, listed, and a DM is in Urgent exactly
 * when its sidebar row shows the indicator.
 *
 * Files are not in it yet: FOL-43.
 */
export function useDeskItems(): { openWork: OpenWorkItem[]; urgent: UrgentItem[] } {
  const openWork = useOpenWork()
  const { partners } = useDmChannels()
  const { dmIsUrgent } = useUnread()
  const people = useWorkspacePeople(partners)

  const urgent = useMemo<UrgentItem[]>(() => {
    if (!hasRelay) return URGENT_ITEMS
    const byKey = new Map((people ?? []).map((p) => [p.id, p]))
    return partners.flatMap((dmId) => {
      const person = byKey.get(dmId)
      if (!person || !dmIsUrgent(dmId)) return []
      return [{ id: `urg_dm_${dmId}`, kind: 'dm' as const, dmId, name: person.name, avatarSrc: person.avatarSrc }]
    })
  }, [partners, dmIsUrgent, people])

  return { openWork: openWork.items, urgent }
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
 * Its own seam, like `useMembership`, rather than two more `usePeekActions` verbs:
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
  const openWorkLoading = useOpenWork().isLoading
  // The Screener's loading is the decisions blob: it is subtractive, so
  // rendering before it arrives shows rows the person has already dismissed.
  // Urgent is not waited on — like the sidebar indicator it lists, a DM joins
  // it when its channel has been read, rather than holding the Desk for the
  // slowest channel.
  const screenerLoading = useScreener().isLoading
  return hasRelay && (screenerLoading || openWorkLoading)
}
