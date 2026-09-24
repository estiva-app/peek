/**
 * The Desk's writes — the one set of actions left here.
 *
 * Until FOL-23 this was every write a topic, huddle, message and reply made:
 * the Convex double-write, the relay mirror of each, and the optimistic local
 * copy. Those went with the Convex topics. A DM's writes are its conversation's
 * (REM-1), and a file's are `useFileConversation`'s.
 */
import { useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useOpenWork } from '@/api/internal/openWork'
import { fileAddressFromScreenerRowId, useScreener } from '@/api/internal/screener'
import { hasConvex } from './store'

export function usePeekActions() {
  const openWork = useOpenWork()
  const screener = useScreener()
  const dismissScreenerRemote = useMutation(api.desk.dismissScreenerItem)
  const snoozeScreenerRemote = useMutation(api.desk.snoozeScreenerItem)

  return {
    // ── Desk (pages keep their instant local hide; these persist it) ──
    /**
     * Dismiss — a watermark for a folded file row, a deletion for a DM.
     *
     * The two halves keep different records because they keep different truths
     * (SHR-10). A folded row has no Convex id to delete: what "dismissed" means
     * is *ignore this conversation up to now*, so it goes into the person's
     * decisions blob as an instant. DMs still have a row, and still lose it.
     */
    dismissScreenerItem(id: string, nowMs: number = Date.now()) {
      const address = fileAddressFromScreenerRowId(id)
      if (address) {
        screener.dismissFile(address, nowMs)
        return
      }
      if (hasConvex) void dismissScreenerRemote({ id })
    },
    /**
     * "Open" → move the item into Open work, which is the blob and nothing else
     * since REM-4.
     *
     * A folded file row leaves the Screener by itself: the fold drops anything
     * in open work. A DM row is `desk.screenerList`'s, which still de-duplicates
     * against a `deskOpenWork` nothing writes any more — so the row is retired
     * the way `addToOpenWork` used to retire it, by deleting it. CON-14 moves
     * that half to the relay.
     */
    addScreenerToOpenWork(id: string, target: { kind: 'dm'; dmId: string } | { kind: 'file'; address: string }) {
      if (target.kind === 'file') {
        openWork.addFile(target.address)
        return
      }
      openWork.addDm(target.dmId)
      if (hasConvex) void dismissScreenerRemote({ id })
    },
    /** "Later" — the item reappears after `untilMs` (an absolute timestamp);
     *  defaults to +24h server-side when omitted. */
    snoozeScreenerItem(id: string, untilMs?: number) {
      const address = fileAddressFromScreenerRowId(id)
      if (address) {
        // A folded row has no server to default it, so the same 24 hours is
        // spelled here, in the one place the blob is written from.
        screener.snoozeFile(address, untilMs ?? Date.now() + 24 * 60 * 60 * 1000)
        return
      }
      if (hasConvex) void snoozeScreenerRemote({ id, until: untilMs })
    },
    /** Remove a DM from Open work, by the partner's pubkey (REM-3). */
    removeDmFromOpenWork(dmId: string) {
      openWork.removeDm(dmId)
    },
  }
}
