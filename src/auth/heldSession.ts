/**
 * The session this device holds, and when the relay can be read with it again
 * (AUT-3).
 *
 * Peek opened while Estiva ID cannot be reached (a laptop waking before its
 * wifi) enters on the token the device holds, expired, and renews it once the
 * network answers (Miky, 17 Oct, on the issue). `validToken()` is null for all
 * of that time, so anything that reads through it skips the device copy too and
 * Desk comes up empty.
 *
 * **What reads the held token:** the device copy and every "me" filter, which
 * need only whose session this is; and the seams that read the copy beside the
 * relay. A relay read with an expired token fails at Estiva ID's `/sign`
 * (`SignerTokenExpired`), before anything reaches the relay, and each seam
 * already treats that as "could not find out", never as an empty answer.
 *
 * **What stays on `validToken()`:** a read that only the relay can answer and
 * whose miss is cheap to wait out (the socket's credential, media, uploads, a
 * link's card value), so an expired token does not spend a `/sign` per try.
 *
 * A read that runs once per mount is re-run by {@link useSessionResumed}, which
 * moves only when a renewal ends a stretch on an expired token, not on every
 * routine renewal.
 */
import { useSyncExternalStore } from 'react'
import { storedToken, type StoredToken } from './estivaId'

/** The session this device holds, expired or not; null only when signed out or ended. */
export function heldToken(): StoredToken | null {
  return storedToken()
}

let resumed = 0
const listeners = new Set<() => void>()

/** A renewal landed after the page ran on an expired token: the relay can be read again. */
export function noteSessionResumed(): void {
  resumed += 1
  for (const listener of listeners) listener()
}

/** Moves each time the relay becomes readable after a stretch on an expired token; a dependency for reads that run once per mount. */
export function useSessionResumed(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => resumed,
    () => resumed,
  )
}
