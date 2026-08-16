/**
 * Drives the auth shell in Peek (PEEK-118).
 *
 * Mounted only when Convex reports the app unauthenticated. Its whole job is to
 * run `decideBoot` once and act on the answer — usually by leaving for Estiva ID
 * before anything is painted, which is why entry with a live session looks like
 * a loading screen rather than a sign-in.
 *
 * The decision itself is in `contract.ts` and is pure. This file is the part
 * that touches `window`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CLIENT_ID, beginSignIn, takeShellReason, validToken } from '../estivaId'
import {
  type ShellReason,
  type ShellState,
  decideBoot,
  logShellEvent,
  readGuard,
} from './contract'

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
     * A live token *and* an unauthenticated verdict from Convex is the
     * configuration fault, not an expired session — wrong issuer, wrong
     * audience, or unreachable JWKS. It is checked first because it is the one
     * state where another round trip through Estiva ID cannot help, and telling
     * somebody to sign in again would send them at a wall.
     */
    if (validToken()) {
      report({ phase: 'failed', reason: 'token_rejected' })
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
