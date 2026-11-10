/**
 * How long the relay has asked this tab to wait — the one binding (PER-13).
 *
 * Buzz meters `POST /query` at 300 a minute **per pubkey**, and two Peek tabs
 * and a Ship tab signed in as one person share that allowance. On 2026-09-23
 * Miky's key reached 306 in one minute, and at 14:37:25 thirty-three reads were
 * refused in the same second — a whole refresh fan-out sent into a pause the
 * relay had announced three seconds earlier.
 *
 * `bridgePost` writes this on every quota refusal (it sees all of them); the
 * refresh triggers skip while it is in force and `withRateLimitRetry` waits it
 * out. The mechanism is `@estiva-app/platform`'s, shared with Ship; the binding
 * is the app's, because a package holding one would be shared by every consumer.
 *
 * Peek's other tabs hear a pause over a `BroadcastChannel`, so the second tab
 * does not have to be refused to learn what the first already knows. Ship is
 * another origin and learns its own.
 */
import { createRelayBudget, type BudgetChannel } from '@estiva-app/platform'

/**
 * What to wait when the relay says it is limited but not for how long — the
 * one branch without a number is `rate-limited: shared admission unavailable`.
 */
export const RATE_LIMIT_DEFAULT_MS = 10_000

function otherTabs(): BudgetChannel | undefined {
  // Absent in a test environment and in old browsers; a tab then learns only
  // from its own refusals, which is what it did before.
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return undefined
  return new window.BroadcastChannel('peek-relay-budget')
}

export const relayBudget = createRelayBudget({
  defaultBackoffMs: RATE_LIMIT_DEFAULT_MS,
  channel: otherTabs(),
})
