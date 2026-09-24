/**
 * The Desk's writes — the one set of actions left here.
 *
 * Until FOL-23 this was every write a topic, huddle, message and reply made:
 * the Convex double-write, the relay mirror of each, and the optimistic local
 * copy. Those went with the Convex topics. A DM's writes are its conversation's
 * (REM-1), and a file's are `useFileConversation`'s. Since CON-14 none of what
 * is left touches Convex: a Screener decision is the person's blob on the relay,
 * and open work has been the relay's since REM-4.
 */
import { useOpenWork } from '@/api/internal/openWork'
import { useScreener } from '@/api/internal/screener'

export function usePeekActions() {
  const openWork = useOpenWork()
  const screener = useScreener()

  return {
    // ── Desk (pages keep their instant local hide; these persist it) ──
    /**
     * Dismiss — a watermark in the person's decisions blob, for a DM row and a
     * file row alike (SHR-10, CON-14). A folded row has no record to delete:
     * what "dismissed" means is *ignore this conversation up to now*, which is
     * what deleting a Convex row meant too, since later traffic re-created it.
     */
    dismissScreenerItem(id: string, nowMs: number = Date.now()) {
      screener.dismiss(id, nowMs)
    },
    /**
     * "Open" → move the item into Open work, which is the blob and nothing else
     * since REM-4. The row leaves the Screener by itself: both folds drop
     * anything in open work (PEE-6), so there is nothing else to retire.
     */
    addScreenerToOpenWork(_id: string, target: { kind: 'dm'; dmId: string } | { kind: 'file'; address: string }) {
      if (target.kind === 'file') openWork.addFile(target.address)
      else openWork.addDm(target.dmId)
    },
    /** "Later" — the item reappears after `untilMs` (an absolute timestamp), 24 hours by default. */
    snoozeScreenerItem(id: string, untilMs: number = Date.now() + 24 * 60 * 60 * 1000) {
      screener.snooze(id, untilMs)
    },
    /** Remove a DM from Open work, by the partner's pubkey (REM-3). */
    removeDmFromOpenWork(dmId: string) {
      openWork.removeDm(dmId)
    },
  }
}
