/**
 * A DM's channel on the relay (DMS-3).
 *
 * Convex-backed only. Against the mock fixture there is nobody with an Estiva
 * ID to open a channel *with*, and `unsignedDmOpen` says so as an expected
 * refusal rather than a failure.
 */
import { useEffect, useRef } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { hasConvex } from './store'
import { validToken } from '@/auth/estivaId'
import { publishDmChannel } from '@/nostr/dms'
import { RELAY_URL } from '@/api/relayUrl'

/**
 * Give this DM a channel on the relay, once, while it is open.
 *
 * ## Why the trigger is a query rather than the mount
 *
 * A DM's row is created lazily — by the first message, or by starring somebody
 * — so a conversation can be open for a while before there is anything to
 * attach a channel to. `unsignedDmOpen` is reactive, so it flips to `ok` the
 * moment the row appears and this fires then, rather than on a mount that
 * happened too early. Opening a DM that already has one costs a query and no
 * publish: the same query answers `already has a channel`.
 *
 * ## Why it is safe to fire in two tabs at once
 *
 * The relay looks a DM's channel up by its participant set, so both tabs are
 * told the same uuid and `recordDmChannel` keeps the first write. The one case
 * that needs handling is both tabs sending *byte-identical* events in the same
 * second, and `publishDmChannel` owns that.
 *
 * Once per DM per tab. A publish that fails leaves the row without a channel
 * until the next open, which is the same bargain `usePublishTopicChannel`
 * makes: a retry loop against a relay that is refusing is worse than a gap.
 */
export function useEnsureDmChannel(dmKey: string | null): void {
  const convex = useConvex()
  const relayUrl = RELAY_URL
  const plan = useQuery(api.nostr.outbox.unsignedDmOpen, hasConvex && dmKey ? { dmKey } : 'skip')
  const needsChannel = plan?.ok === true
  const attempted = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!dmKey || !relayUrl || !needsChannel) return
    if (attempted.current.has(dmKey)) return
    attempted.current.add(dmKey)
    // `validToken()` at call time, never a snapshot — see `tokenForPublish` in
    // actions.ts for why that constant goes stale.
    const token = validToken()
    if (!token) {
      console.warn('[nostr] DM channel not opened: no live Estiva ID token in this tab')
      return
    }
    void publishDmChannel(dmKey, relayUrl, token, {
      unsignedDmOpen: (args) => convex.query(api.nostr.outbox.unsignedDmOpen, args as never),
      recordDmChannel: async (args) => {
        await convex.mutation(api.nostr.outbox.recordDmChannel, args as never)
      },
    })
      .then((result) => {
        if (!result.ok && !result.expected) console.warn('[nostr] DM channel open failed:', result.reason)
      })
      .catch((error) => console.warn('[nostr] DM channel open failed:', error))
  }, [dmKey, relayUrl, needsChannel, convex])
}
