import { useCallback, useEffect, useRef, useState } from 'react'
import type { Membership } from '@estiva-app/conversation'
import { validToken } from '@/auth/estivaId'
import { RELAY_URL } from '@/api/relayUrl'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { fetchFileMembers } from '@/nostr/fileMembers'

/** One read of a file's members, or `undefined` with no relay, no token, or no answer. */
async function readMembers(address: string): Promise<Map<string, Membership> | undefined> {
  const token = validToken()
  if (!RELAY_URL || !token) return undefined
  return fetchFileMembers({ relayUrl: RELAY_URL, accessToken: token.accessToken, pubkey: token.pubkey }, address).catch((error: unknown) => {
    console.warn('[membership] could not read the members of', address, error)
    return undefined
  })
}

/**
 * The last roster read per address, for this tab. The page remounts when its
 * link turns canonical (`/topic/<address>` → `/issue/<slug>`) and when the
 * person comes back to a file: without it the pill went out until the relay
 * answered again.
 */
const lastRead = new Map<string, ReadonlyMap<string, Membership>>()

/**
 * Everyone who is a member of one file, for its Members dialog (REA-3).
 * `members` is `undefined` until the relay has answered for this address —
 * nothing is drawn rather than a wrong count — and keeps the last answer when
 * a later read fails. `failed` says the relay did not answer for this address
 * and nothing is held, so the page can offer Join some other way. `reload`
 * re-reads it after a change.
 */
export function useFileMembers(address: string | undefined): {
  members: ReadonlyMap<string, Membership> | undefined
  failed: boolean
  reload: () => Promise<void>
} {
  const [read, setRead] = useState<{ address: string; members?: ReadonlyMap<string, Membership> }>()
  /** Reads in order of starting: one that lands after a newer one began is dropped, so a read begun before a Join cannot undo it. */
  const started = useRef(0)
  const reload = useCallback(() => {
    if (!address) return Promise.resolve()
    const mine = ++started.current
    return readMembers(address).then((members) => {
      if (mine !== started.current) return
      if (members) lastRead.set(address, members)
      // A failed read keeps what was held; it is marked only so `failed` can say so.
      setRead((prev) => (members ? { address, members } : prev?.address === address && prev.members ? prev : { address }))
    })
  }, [address])
  useEffect(() => {
    void reload()
  }, [reload])
  // Somebody else joins, leaves or adds: re-read when the person comes back to the tab. Not on the 30 s
  // interval: every relay read costs an Estiva ID /sign, and the membership sync already polls.
  useRefreshTriggers(() => void reload(), { enabled: !!address && !!RELAY_URL, interval: false })
  const own = read && read.address === address ? read : undefined
  const members = own?.members ?? (address ? lastRead.get(address) : undefined)
  return { members, failed: !members && !!own, reload }
}
