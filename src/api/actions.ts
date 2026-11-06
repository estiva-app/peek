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
import { heldToken } from '@/auth/heldSession'
import {
  addToTeamAsViewer,
  followTeamAsViewer,
  joinTeamAsViewer,
  leaveTeamAsViewer,
  markSpaceAsViewer,
  type TeamWrite,
} from '@/nostr/teams'
import { addToPlaceAsViewer, choosePlaceLevelAsViewer, type PlaceRead } from '@/nostr/places'
import type { Place, SwitchChoice } from '@estiva-app/conversation'
import { RELAY_URL } from './relayUrl'
import { reloadTeamsOnScreen } from './useTeams'

/** A team write as the viewer, then the teams read again so the change shows; a throw is said, never lost. */
async function asViewer(write: (relayUrl: string, token: NonNullable<ReturnType<typeof heldToken>>) => Promise<TeamWrite>): Promise<TeamWrite> {
  const token = heldToken()
  if (!RELAY_URL || !token) return { ok: false, reason: 'Sign in first.' }
  const result = await write(RELAY_URL, token).catch((error: unknown) => ({
    ok: false as const,
    reason: `Nothing changed: ${(error as Error)?.message ?? 'the write failed'}. Try again.`,
  }))
  if (result.ok) await reloadTeamsOnScreen()
  return result
}

export function usePeekActions() {
  const openWork = useOpenWork()
  const screener = useScreener()

  return {
    // ── Teams (TEA-5): each answers what the relay said, for the page's toast ──
    /** Join a team: a `kind:9021` (§3.3). */
    joinTeam: (team: string) => asViewer((relayUrl, token) => joinTeamAsViewer(team, relayUrl, token)),
    /** Leave a team: a `kind:9022`. */
    leaveTeam: (team: string) => asViewer((relayUrl, token) => leaveTeamAsViewer(team, relayUrl, token)),
    /** Add someone to a team the viewer is in: a `kind:9000`. */
    addToTeam: (team: string, person: string) => asViewer((relayUrl, token) => addToTeamAsViewer(team, person, relayUrl, token)),
    /** Follow a team, or stop: the viewer's private teams list. */
    followTeam: (team: string, follow: boolean) => asViewer((relayUrl, token) => followTeamAsViewer(team, follow, relayUrl, token)),
    /** Make a topic one of a team's spaces, or not: a `kind:1852 add` with or without the `space` role. */
    markSpace: (team: string, address: string, space: boolean) =>
      asViewer((relayUrl, token) => markSpaceAsViewer(team, address, space, relayUrl, token)),

    // ── Following a place (TEA-6): a topic, a space or a team's chat ──
    /** One pick on the place's switch: Not following, Important, All, or back to the team's default (§11.8). */
    choosePlaceLevel: (args: { place: Place; folder: string; choice: SwitchChoice; read: PlaceRead; archived: boolean; muted: boolean }) =>
      asViewer((relayUrl, token) => choosePlaceLevelAsViewer(args, relayUrl, token)),
    /** Add someone to the place: they join it at Important, and can leave. */
    addToPlace: (args: { place: Place; folder: string; person: string; read: PlaceRead }) =>
      asViewer((relayUrl, token) => addToPlaceAsViewer(args, relayUrl, token)),

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
