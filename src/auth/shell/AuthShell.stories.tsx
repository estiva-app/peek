import type { Meta, StoryObj } from '@storybook/react-vite'
import { AuthShell } from './AuthShell'

/**
 * Every state of the entry surface, with no identity service involved.
 *
 * `AuthShell` takes its state as a prop and performs no I/O, so the states that
 * are awkward to reach in a browser — a rejected token, a suspended identity, a
 * tripped loop guard — are one arg away here. Reaching them against a real
 * Estiva ID would mean breaking a deployment on purpose.
 *
 * The copy lives in `contract.ts`, not in this component, and is duplicated
 * verbatim in Ship. Change it there and `contract.test.ts` keeps the two copies
 * honest — editing the string here would only make them drift.
 */
const meta = {
  title: 'Entry/AuthShell',
  component: AuthShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <Story />
    ),
  ],
  args: {
    onContinue: () => {},
  },
} satisfies Meta<typeof AuthShell>

export default meta
type Story = StoryObj<typeof meta>

/**
 * **The screen people actually see when they are not signed in.**
 *
 * Reached after a silent `prompt=none` probe comes back `login_required`. One
 * affordance, no branding beyond the badge: the thing it must never look like
 * is a sign-in page for an identity the person already holds.
 */
export const NoSession: Story = {
  args: { state: { phase: 'authenticating', reason: 'no_session' } },
}

/**
 * The common case, and the one to get right: a boot that resolves before
 * anything renders. The badge is revealed on a 150ms delay, so a fast entry
 * flashes nothing at all.
 */
export const Checking: Story = {
  args: { state: { phase: 'checking' } },
}

/** Deliberately identical to `Checking` — two loading screens for one boot is the bug. */
export const Entering: Story = {
  args: { state: { phase: 'entering' } },
}

/** The token died mid-session. Same affordance, copy that says what happened. */
export const SessionExpired: Story = {
  args: { state: { phase: 'failed', reason: 'session_expired' } },
}

/** A silent attempt bounced straight back. The guard stops the loop and hands over. */
export const LoopGuard: Story = {
  args: { state: { phase: 'authenticating', reason: 'loop_guard' } },
}

export const ExchangeFailed: Story = {
  args: { state: { phase: 'failed', reason: 'exchange_failed' } },
}

export const Network: Story = {
  args: { state: { phase: 'failed', reason: 'network' } },
}

export const Timeout: Story = {
  args: { state: { phase: 'failed', reason: 'timeout' } },
}

/**
 * Not recoverable, so **no button** — the longest copy in the set, and the one
 * that must never read as "signed out". Signing in again cannot fix a
 * configuration fault, and saying otherwise cost a real debugging detour.
 */
export const TokenRejected: Story = {
  args: { state: { phase: 'failed', reason: 'token_rejected' } },
}

/**
 * Also no button: a suspended or offboarded identity is the one refusal a
 * person cannot clear themselves. Only an administrator can.
 */
export const IdentityInactive: Story = {
  args: { state: { phase: 'failed', reason: 'identity_inactive' } },
}
