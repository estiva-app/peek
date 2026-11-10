/**
 * Drives the auth shell in Peek (PEEK-118).
 *
 * Mounted only when the Estiva ID session reports signed out (REM-2; it was
 * Convex's verdict until then, which is what the live-token branch below was
 * written against). Its whole job is to
 * run `decideBoot` once and act on the answer — usually by leaving for Estiva ID
 * before anything is painted, which is why entry with a live session looks like
 * a loading screen rather than a sign-in.
 *
 * The decision itself is in `contract.ts` and is pure. This file is the part
 * that touches `window`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CLIENT_ID, beginSignIn, refreshAccessToken, takeShellReason, validToken } from '../estivaId'
import {
  GUARD_TTL_MS,
  type ShellReason,
  type ShellState,
  decideBoot,
  logShellEvent,
  readGuard,
} from '@estiva-app/identity'

/**
 * Set once this page load has been inside the app.
 *
 * Module-level rather than React state because it has to survive the shell
 * unmounting and remounting, which is exactly what happens when a token expires
 * under somebody: `Authenticated` swaps to `Unauthenticated`, and a fresh
 * `useAuthShell` would otherwise look identical to a cold boot and navigate
 * away with their work on screen (PEEK-123).
 */
let enteredThisPageLoad = false

export function markEntered(): void {
  enteredThisPageLoad = true
}

export function useAuthShell(): { state: ShellState; onContinue: () => void } {
  const [state, setState] = useState<ShellState>({ phase: 'checking' })
  const ran = useRef(false)
  const startedAt = useRef(Date.now())

  const report = useCallback((next: ShellState) => {
    setState(next)
    logShellEvent({
      app: CLIENT_ID,
      phase: next.phase,
      ...('reason' in next ? { reason: next.reason } : {}),
      elapsedMs: Date.now() - startedAt.current,
    })
  }, [])

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    /**
     * A live token *and* an unauthenticated verdict from Convex.
     *
     * This used to report `token_rejected` outright, on the reasoning that a
     * token the app considers valid and a server refuses is a configuration
     * fault — wrong issuer, wrong audience, unreachable JWKS — where another
     * round trip through Estiva ID cannot help. That reasoning is still right
     * about configuration faults. What it got wrong is treating "the app
     * considers it valid" as established rather than as a claim worth checking
     * (PEE-23).
     *
     * It is a claim that has been false in production. `expiresAt` was derived
     * from `expires_in` plus the local clock while the service checks the
     * token's own `exp` against *its* clock, so a browser clock ahead of the
     * service — a machine waking from sleep does it readily — left the app
     * holding a token every server refused and `validToken()` happily returned.
     * `identity` 0.1.3 takes the earlier of the two bounds and closes that
     * particular door, but the branch below is what made it unrecoverable:
     * `token_rejected` is deliberately not recoverable, so the shell showed no
     * affordance at all, and `fetchAccessToken` returns early whenever
     * `validToken()` is non-null, so Convex's own retry handed back the same
     * refused token forever. Nothing renewed. Clearing site data was the only
     * exit.
     *
     * So: spend one renewal establishing which it is. A configuration fault
     * survives a renewal and still reaches the same screen, having been proved
     * rather than assumed.
     */
    if (validToken()) {
      void establishWhetherItIsReallyConfiguration(report)
      return
    }

    // Handed over by `/auth/callback` across the full page load it ends in.
    const carried = takeShellReason()
    if (carried) {
      report(shellStateFor(carried))
      return
    }

    const action = decideBoot({
      callback: null,
      hasValidToken: false,
      guardAttemptedAt: readGuard(window.sessionStorage),
      enteredThisPageLoad,
      now: Date.now(),
    })

    switch (action.do) {
      case 'probe_silently':
        report({ phase: 'checking' })
        // Navigates away; nothing after this runs. A rejection means the
        // navigation never happened, which is a broken browser rather than a
        // refusal — say so rather than sitting on the loading state forever.
        void beginSignIn(window.location.pathname + window.location.search, { silent: true }).catch(
          () => report({ phase: 'failed', reason: 'network' }),
        )
        break
      case 'prompt_passkey':
        report(shellStateFor(action.reason))
        break
      default:
        // `enter` and `complete_callback` cannot arrive here: this hook only
        // mounts with no valid token, and the callback lives on its own route.
        report({ phase: 'failed', reason: 'no_session' })
    }
  }, [report])

  /**
   * The one tap. WebAuthn needs a user activation, so this cannot be automated
   * — which is why `authenticating` is a state with an affordance rather than
   * something the shell does on its own.
   */
  const onContinue = useCallback(() => {
    report({ phase: 'checking' })
    void beginSignIn(window.location.pathname + window.location.search).catch(() =>
      report({ phase: 'failed', reason: 'network' }),
    )
  }, [report])

  return { state, onContinue }
}

/**
 * Marks that this page-load chain has already spent its one renewal.
 *
 * Timestamped and time-boxed rather than cleared on success, for the same
 * reason the silent-attempt guard is: the successful path *reloads*, so there is
 * no later moment in this document to clean up in, and a marker that outlived
 * its cause would make the next genuine skew a dead end again without even
 * trying. `GUARD_TTL_MS` is reused deliberately — a stale marker and a stale
 * probe guard are the same kind of mistake and should expire on the same clock.
 */
const RENEWAL_KEY = 'peek.authShell.refusedTokenRenewal'

function renewalAlreadySpent(now: number): boolean {
  const raw = window.sessionStorage.getItem(RENEWAL_KEY)
  if (!raw) return false
  const at = Number(raw)
  return Number.isFinite(at) && now - at < GUARD_TTL_MS
}

/**
 * Find out whether a refused-but-locally-valid token is stale or misconfigured.
 *
 * Three outcomes, and only the third is the screen with no way out:
 *
 * 1. **The renewal works.** The token was merely stale. Reload, so the app boots
 *    against the fresh one — a reload rather than a re-render because
 *    `api/store.tsx` hands Convex its auth source at mount and the refused token
 *    is already in flight through it.
 * 2. **The renewal fails.** There is no live session behind it, whatever the
 *    stored token said. `session_expired` offers a passkey, which is both true
 *    and actionable.
 * 3. **A renewal was already spent this page-load chain**, so the *fresh* token
 *    was refused too. Now the configuration fault is established, and this is
 *    where the original reasoning was heading all along.
 */
async function establishWhetherItIsReallyConfiguration(
  report: (next: ShellState) => void,
): Promise<void> {
  if (renewalAlreadySpent(Date.now())) {
    report({ phase: 'failed', reason: 'token_rejected' })
    return
  }

  report({ phase: 'checking' })
  // Written before the request, not after it. The await is exactly the window a
  // second mount would slip through, which is the same lesson as the silent
  // guard being marked beside its writes rather than beside the navigation.
  window.sessionStorage.setItem(RENEWAL_KEY, String(Date.now()))

  let renewed: Awaited<ReturnType<typeof refreshAccessToken>> = null
  try {
    renewed = await refreshAccessToken()
  } catch {
    // Treated as a failed renewal. An exception here is a broken fetch rather
    // than a refusal, and either way there is no fresh token to boot with.
    renewed = null
  }

  if (!renewed) {
    // `refreshAccessToken` has already cleared the session on a refusal, so the
    // next load is an ordinary cold boot rather than a return to this branch.
    window.sessionStorage.removeItem(RENEWAL_KEY)
    report(shellStateFor('session_expired'))
    return
  }

  window.location.reload()
}

/**
 * A reason that a passkey can clear is an invitation, not a failure.
 *
 * The distinction is the difference between a shell that looks like a dead end
 * and one that looks like a step.
 */
function shellStateFor(reason: ShellReason): ShellState {
  const offersPasskey =
    reason === 'no_session' || reason === 'session_expired' || reason === 'loop_guard'
  return offersPasskey ? { phase: 'authenticating', reason } : { phase: 'failed', reason }
}
