/**
 * Signing out.
 *
 * One sign-in, one sign-out, since PEEK-41 removed Convex Auth. This used to
 * bridge two of them and had to call `useAuthActions` unconditionally, because
 * outside `ConvexAuthProvider` it *returns undefined* rather than throwing —
 * which is how it first surfaced: `TopBar` destructured it directly and crashed
 * the app the moment anyone signed in with Estiva ID. That whole hazard is gone
 * with the second provider.
 *
 * **This now ends the Estiva ID session, not just Peek's copy of a token**
 * (PEEK-122). The previous version cleared the token and reloaded, and this file
 * said why that was narrow but defensible: signing back in was silent, which is
 * what single sign-on means.
 *
 * The auth shell made it indefensible. Entry is automatic now, so clearing the
 * token and reloading ran the silent probe, which succeeded against the
 * untouched cookie and put the person straight back in. The button did nothing
 * visible. That is the whole bug, and it is a good example of a behaviour that
 * was fine in isolation becoming wrong when something else changed.
 *
 * So signing out here signs you out of every Estiva app. That is a deliberate
 * decision rather than an inherited one — see PEEK-122 for the trade-off, and
 * for the one thing it does not do: tokens already issued live out their
 * lifetime (Estiva ID's policy, read from `expires_in`), so another app's
 * *already-open* tab keeps working until its token expires.
 */
import { useCallback } from 'react'
import { beginSignOut } from './estivaId'
import { clearDeviceCopy } from '@/nostr/deviceCopy'

export function useSignOut(): () => void {
  // Navigates to the identity origin, so nothing after it runs. The cookie is
  // only reachable by going there — the same reason entry works the way it does.
  // The copy on the device goes first (PEE-2: kept until sign-out); clearing
  // waits at most a second, so a stuck IndexedDB never keeps anyone signed in.
  return useCallback(() => void clearDeviceCopy().then(() => beginSignOut()), [])
}
