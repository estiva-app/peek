/**
 * Whether this tab is signed in with Estiva ID, kept true by renewing the
 * token before it runs out (PEEK-104, PEEK-108).
 *
 * ## There is a silent refresh (PEEK-108)
 *
 * There used to not be: no `refresh_token` grant, and the session cookie that
 * would authorise a silent renewal is `SameSite=Lax`, withheld from the hidden
 * iframe such a renewal would need. So an expired token could only be replaced
 * by a top-level navigation.
 *
 * Estiva ID issues refresh tokens now, so an expiry costs a `fetch` instead of
 * the page. The cookie is still `SameSite=Lax`, but the refresh token is a
 * credential the app holds itself, so renewing it needs no cookie at all.
 *
 * When refresh is refused, this reports no identity and the auth shell takes
 * over. A refresh token is revoked by signing out and by offboarding, so
 * "refresh refused" is a real state rather than a theoretical one.
 *
 * ## Coming back renews in place (AUT-3)
 *
 * Opening Peek with an expired token and a refresh token beside it renews here,
 * before the shell mounts, instead of the shell's trip to Estiva ID and back:
 * measured as QA-1 on 16 Oct, every return after an hour left the page. The
 * renewal runs on the package's schedule (`scheduleRenewal`), which also renews
 * when a throttled background tab is shown again or the network comes back,
 * and treats an unreachable Estiva ID as a retry rather than a sign-out.
 */
import { useEffect, useRef, useState } from 'react'
import { decideAfterRenewal, readGuard } from '@estiva-app/identity'
import { SESSION_KEY, renew, scheduleRenewal, stashShellReason, storedToken, validToken } from './estivaId'
import { noteSessionResumed } from './heldSession'

/** How long the way in waits for a renewal before entering on what the device holds. A renewal takes 100–300 ms. */
export const RENEWAL_WAIT_MS = 3_000

/**
 * Whether a token due at `expiresAt` has really run out by now. The package
 * sets `expiresAt` 30 s before the token's end, and a routine renewal lands
 * within a second of it; one landing past the end followed a stretch with no
 * live token, when relay reads failed.
 */
function ranOut(expiresAt: number | null): boolean {
  return expiresAt !== null && Date.now() > expiresAt + 30_000
}

export function useEstivaIdAuth() {
  // Seeded synchronously: the token is already in storage on first render —
  // after the callback redirect, or another tab's sign-in — so there is no
  // loading window to show and no flash of the signed-out screen.
  const [expiresAt, setExpiresAt] = useState<number | null>(() => validToken()?.expiresAt ?? null)
  // An expired token with a refresh token beside it: renewed before anything
  // is decided, and the shell is not shown meanwhile.
  const [renewing, setRenewing] = useState(() => expiresAt === null && Boolean(storedToken()?.refreshToken))
  // Entered on an expired token, or a renewal that landed after the token had
  // run out (asleep, offline, a throttled tab): the renewal that ends it tells
  // the reads that ran meanwhile to read the relay again (`heldSession.ts`).
  const lapsed = useRef(false)
  const expiry = useRef(expiresAt)
  useEffect(() => {
    expiry.current = expiresAt
  }, [expiresAt])

  useEffect(() => {
    if (!renewing) return
    let live = true
    // A renewal the network neither answers nor fails (wifi joined, no route
    // yet) would hold a blank page for as long as the browser waits. Past this,
    // the page enters on the held token as for an unreachable Estiva ID, and
    // the schedule takes over the renewal still out: the package coalesces it,
    // so its answer, a refusal included, reaches the schedule.
    const wait = window.setTimeout(() => {
      live = false
      lapsed.current = true
      setExpiresAt(storedToken()?.expiresAt ?? null)
      setRenewing(false)
    }, RENEWAL_WAIT_MS)
    void renew().then((result) => {
      if (!live) return
      window.clearTimeout(wait)
      const next = decideAfterRenewal(result.outcome, {
        callback: null,
        hasValidToken: false,
        guardAttemptedAt: readGuard(window.sessionStorage),
        enteredThisPageLoad: false,
        now: Date.now(),
      })
      // A token already out of date (a clock ahead of Estiva ID's) is no
      // renewal; the shell sorts it out the way it always has.
      if (result.outcome === 'renewed') {
        if (result.token.expiresAt > Date.now()) setExpiresAt(result.token.expiresAt)
      }
      // Estiva ID could not be reached (wifi not up yet): enter on what the
      // device holds, Desk from its copy, and let the schedule renew the
      // expired token once the network answers. Its expiry arms the schedule
      // at once, and every retry after (Miky, 17 Oct, on the issue).
      else if (next.do === 'enter') {
        lapsed.current = true
        setExpiresAt(storedToken()?.expiresAt ?? null)
      }
      // Handed to the shell, which shows it on this page rather than probing.
      else if (next.do === 'prompt_passkey' || next.do === 'fail') stashShellReason(next.reason)
      setRenewing(false)
    })
    return () => {
      live = false
      window.clearTimeout(wait)
    }
  }, [renewing])

  // Every tab shares the session (PEE-3). Another tab renewing re-arms this
  // tab's timer from the new expiry instead of renewing again; another tab
  // signing out, or its renewal being refused, drops this one to the shell at
  // once rather than at its next read, on the same plain sign-in screen the
  // signing-out tab shows. A `null` key is the store being cleared.
  //
  // A session that appears again after this page lost it — somebody signing in
  // in another tab, perhaps somebody else — is entered by reloading, never by
  // re-mounting: this page's stores still hold what the last session read.
  // The same goes for a token for somebody else replacing this one outright: the
  // live socket authenticated as the person this page loaded with.
  //
  // A session is what the device holds, expired or not: a tab that entered
  // offline on an expired token is still signed in, and is renewing it.
  const lost = useRef(false)
  const person = useRef(storedToken()?.pubkey)
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || (event.key !== SESSION_KEY && event.key !== null)) return
      const token = storedToken()
      if (token === null) {
        if (!lost.current) stashShellReason('no_session')
        lost.current = true
      } else if (lost.current || (person.current !== undefined && token.pubkey !== person.current)) {
        window.location.reload()
        return
      }
      person.current ??= token?.pubkey
      // Another tab's renewal ends this one's stretch on an expired token too.
      if (token && token.expiresAt > Date.now() && (lapsed.current || ranOut(expiry.current))) {
        lapsed.current = false
        noteSessionResumed()
      }
      // An expired token another tab wrote does not sign this tab in: only a
      // tab already in renews one in place.
      setExpiresAt((current) => (token && (current !== null || token.expiresAt > Date.now()) ? token.expiresAt : null))
    }
    window.addEventListener('storage', follow)
    return () => window.removeEventListener('storage', follow)
  }, [])

  // Renew before expiry rather than reacting to a refused read: the person
  // notices nothing. The package coalesces concurrent renewals, so one the auth
  // shell started at the same moment is shared, not spent twice — a refresh
  // token is single-use, and Estiva ID treats a second presentation as theft.
  // Across tabs the package's lock does the same.
  const signedIn = expiresAt !== null
  useEffect(() => {
    if (!signedIn) return
    const schedule = scheduleRenewal({
      onRenewed: (token) => {
        if (lapsed.current || ranOut(expiry.current)) {
          lapsed.current = false
          noteSessionResumed()
        }
        setExpiresAt(token.expiresAt)
      },
      onEnded: () => {
        lost.current = true
        setExpiresAt(null)
      },
    })
    return () => schedule.cancel()
  }, [signedIn])

  return { isAuthenticated: signedIn, renewing }
}
