/**
 * The auth shell, rendered (PEEK-116).
 *
 * One surface for the whole of entry: the loading state, and the place a
 * passkey is invoked when loading is not enough. It is deliberately the same
 * canvas in every state — a logo, and at most one affordance — because the
 * thing it must never look like is a sign-in page. An app that shows a branded
 * login screen for the same identity system the person is already signed into
 * is two products stitched together, which is the seam this milestone closes.
 *
 * Ship renders the same states with the same copy in plain DOM. The shared
 * artifact is the contract, not this component — see `contract.ts`.
 */
import { Button } from '@/components/ui/Button'
import { PeekLogoBadge } from '@/components/ui/PeekLogo'
import { CONTINUE_LABEL, RETRY_LABEL, SHELL_COPY, type ShellState, isRecoverable } from '@estiva-app/identity'

export interface AuthShellProps {
  state: ShellState
  /** Start the passkey flow. Must run from the tap — WebAuthn needs the gesture. */
  onContinue: () => void
}

/**
 * What shows while nobody is signed in: Peek's badge, one line saying why, and
 * at most one button, which starts the passkey sign-in.
 */
export function AuthShell({ state, onContinue }: AuthShellProps) {
  /**
   * Waiting states show the badge and nothing else.
   *
   * Same 150ms-delayed reveal as the skeletons, so an entry that resolves fast
   * — which is the common case, and the one this milestone is for — never
   * flashes anything at all.
   */
  if (state.phase === 'checking' || state.phase === 'entering' || state.phase === 'ready') {
    return (
      <ShellCanvas>
        <PeekLogoBadge size={40} className="animate-skeleton-in animate-pulse" />
      </ShellCanvas>
    )
  }

  const { reason } = state
  const recoverable = isRecoverable(reason)

  return (
    <ShellCanvas>
      <PeekLogoBadge size={40} />
      <p className="text-body-2 text-text-secondary max-w-sm text-center">{SHELL_COPY[reason]}</p>
      {recoverable && (
        <Button variant="primary" type="button" onClick={onContinue}>
          {state.phase === 'authenticating' ? CONTINUE_LABEL : RETRY_LABEL}
        </Button>
      )}
    </ShellCanvas>
  )
}

/** The canvas every state shares, so nothing shifts as the state changes. */
function ShellCanvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4">{children}</div>
    </div>
  )
}
