/**
 * The auth shell, rendered (PEEK-116).
 *
 * One surface for the whole of entry: the loading state, and the place a
 * passkey is invoked when loading is not enough. The screen itself is the
 * package's `EntryShell` (AUT-3), so Ship and Leaf can draw the same one; this
 * wrapper keeps what only Peek knows: its badge, and which words and which
 * button each state of entry gets, from `@estiva-app/identity`.
 */
import { EntryShell } from '@estiva-app/ui'
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
  const logo = <PeekLogoBadge size={40} />

  // Waiting states show the badge and nothing else. In Signal the badge shimmers
  // and shows at once (`.signal .animate-pulse` overrides the 150 ms reveal), as
  // before the move; to a screen reader the package says "Loading".
  if (state.phase === 'checking' || state.phase === 'entering' || state.phase === 'ready') {
    return <EntryShell logo={logo} busy />
  }

  const { reason } = state
  return (
    <EntryShell
      logo={logo}
      message={SHELL_COPY[reason]}
      action={
        isRecoverable(reason)
          ? { label: state.phase === 'authenticating' ? CONTINUE_LABEL : RETRY_LABEL, onClick: onContinue }
          : undefined
      }
    />
  )
}
