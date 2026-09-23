/**
 * Hidden DMs, for the sidebar (DMS-6).
 *
 * The set lives on the relay and is read from there (`useDmVisibilitySync`);
 * what this provider adds is the join the sidebar needs. The relay names a DM
 * by its channel uuid and the app names one by the partner's person key
 * (§2.4), and `dmChannels` is the map between them — Convex's only part in
 * this, and a rendering part: it says *which row* a uuid is, never whether it
 * is hidden.
 *
 * ## Only offer what can succeed
 *
 * `canHideDm` is false until two things are true: the DM has a channel (a
 * conversation nobody has spoken in has nothing on the relay to hide) and the
 * relay has said what it holds (a hide sent before the answer would be applied
 * to a set this tab has not seen). So the menu item appears only on rows that
 * can be hidden, which is the rule every action here follows.
 *
 * ## Re-open is the unhide
 *
 * `reopenDm` publishes the same `kind:41010` that opened the channel; the
 * relay clears the viewer's `hidden_at` and republishes their snapshot. It is
 * called when the viewer opens a hidden DM (`useDmConversationView`), which is
 * the one gesture that unambiguously means "I want this back".
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { hasConvex } from '@/api/store'
import { useDmVisibilitySync } from '@/nostr/useDmVisibilitySync'
import { publishDmHide } from '@/nostr/dmVisibility'
import { publishDmChannel } from '@/nostr/dms'
import { validToken } from '@/auth/estivaId'
import { RELAY_URL } from '@/api/relayUrl'

export interface DmVisibilityValue {
  /** Whether the relay has said what is hidden. `unknown` hides nothing. */
  state: 'unknown' | 'present'
  isDmHidden: (dmKey: string) => boolean
  /** The DM has a channel and the relay has answered, so a hide can succeed. */
  canHideDm: (dmKey: string) => boolean
  /** Hide from this viewer's sidebar. Never throws; a failure is logged. */
  hideDm: (dmKey: string) => Promise<void>
  /** Bring a hidden DM back. Never throws; a failure is logged. */
  reopenDm: (dmKey: string) => Promise<void>
}

const DmVisibilityContext = createContext<DmVisibilityValue | null>(null)

export function DmVisibilityProvider({ children }: { children: ReactNode }) {
  const convex = useConvex()
  const relayUrl = RELAY_URL
  const channels = useQuery(api.nostr.outbox.dmChannels, hasConvex ? {} : 'skip')
  const { hidden, state, seam, applyHidden } = useDmVisibilitySync(relayUrl)

  const channelByKey = useMemo(() => new Map((channels ?? []).map((c) => [c.dmKey, c.channelUuid])), [channels])

  const isDmHidden = useCallback(
    (dmKey: string) => {
      const channel = channelByKey.get(dmKey)
      return channel !== undefined && hidden.has(channel)
    },
    [channelByKey, hidden],
  )

  const canHideDm = useCallback(
    (dmKey: string) => state === 'present' && channelByKey.has(dmKey) && !isDmHidden(dmKey),
    [state, channelByKey, isDmHidden],
  )

  const hideDm = useCallback(
    async (dmKey: string) => {
      const current = seam()
      if (!current) {
        console.warn('[dms] not hidden: no relay origin or no live Estiva ID token in this tab')
        return
      }
      try {
        const result = await publishDmHide(dmKey, current, {
          unsignedDmHide: (args) => convex.query(api.nostr.outbox.unsignedDmHide, args as never),
        })
        if (result.ok && result.channelUuid) {
          await applyHidden(result.channelUuid, true)
        } else if (!result.expected) {
          console.warn('[dms] hide failed:', result.reason)
        }
      } catch (error) {
        console.warn('[dms] hide threw:', error)
      }
    },
    [convex, seam, applyHidden],
  )

  const reopenDm = useCallback(
    async (dmKey: string) => {
      const channel = channelByKey.get(dmKey)
      const token = validToken()
      if (!relayUrl || !token || !channel) return
      try {
        const result = await publishDmChannel(
          dmKey,
          relayUrl,
          token,
          {
            unsignedDmOpen: (args) => convex.query(api.nostr.outbox.unsignedDmOpen, args as never),
            recordDmChannel: async (args) => {
              await convex.mutation(api.nostr.outbox.recordDmChannel, args as never)
            },
          },
          { reopen: true },
        )
        if (result.ok) {
          await applyHidden(channel, false)
        } else if (!result.expected) {
          console.warn('[dms] re-open failed:', result.reason)
        }
      } catch (error) {
        console.warn('[dms] re-open threw:', error)
      }
    },
    [convex, relayUrl, channelByKey, applyHidden],
  )

  const value = useMemo<DmVisibilityValue>(
    () => ({ state, isDmHidden, canHideDm, hideDm, reopenDm }),
    [state, isDmHidden, canHideDm, hideDm, reopenDm],
  )

  return <DmVisibilityContext.Provider value={value}>{children}</DmVisibilityContext.Provider>
}

export function useDmVisibility(): DmVisibilityValue {
  const ctx = useContext(DmVisibilityContext)
  if (!ctx) throw new Error('useDmVisibility must be used inside DmVisibilityProvider')
  return ctx
}
