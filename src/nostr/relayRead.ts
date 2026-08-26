/**
 * What a failed relay read means (PEE-10).
 *
 * Every read failure in Peek used to end in `console.warn` and a silent return.
 * Swallowing was right and still is — a relay that is down must leave the app
 * working off its Convex rows, and a toast per failed poll on a flaky
 * connection is worse than silence. What was missing is that **the person
 * cannot tell it happened**: an empty panel meaning "refused" looks exactly
 * like an empty panel meaning "nothing here", and that ambiguity is what makes
 * an app feel untrustworthy rather than merely slow.
 *
 * So failures are classified rather than flattened, and the classification is
 * here because three places need the same one: the sidebar deciding which empty
 * state to draw, the freshness indicator deciding whether this counts as an
 * outage, and the logs.
 *
 * ## `not_a_member` is an answer, not an error
 *
 * `relay_membership_required` means the viewer is not a member of that channel.
 * That is a true fact about the world, arrived at successfully. Reporting it as
 * an outage would tell somebody the app is broken because they opened something
 * they are not in — and would light the connection indicator for a healthy
 * relay that answered correctly and promptly.
 */

export type RelayFailureKind =
  /** No answer: the network, DNS, the origin. Retrying may work. */
  | 'unreachable'
  /** The relay answered, and said no. Retrying will not help by itself. */
  | 'refused'
  /** Not an error: the viewer is not a member of this channel. */
  | 'not_a_member'

/** A relay read that did not produce data, carrying why. */
export class RelayReadError extends Error {
  readonly kind: RelayFailureKind
  readonly reason: string

  constructor(reason: string) {
    super(`relay read failed: ${reason}`)
    this.name = 'RelayReadError'
    this.reason = reason
    this.kind = classifyRelayFailure(reason)
  }
}

/**
 * Classify what the relay (or the network) said.
 *
 * Matched on the substrings Buzz actually returns rather than on exact strings:
 * `queryRelay` surfaces `parsed.error` when there is one and a slice of the raw
 * body otherwise, so the text is not a stable contract. The default is
 * `unreachable`, which is the recoverable reading — the one that keeps retrying
 * and does not tell anybody something is permanently wrong.
 */
export function classifyRelayFailure(reason: string): RelayFailureKind {
  const text = reason.toLowerCase()
  if (text.includes('relay_membership_required') || text.includes('membership required')) {
    return 'not_a_member'
  }
  if (text.includes('restricted') || text.includes('auth-required') || text.includes('forbidden')) {
    return 'refused'
  }
  return 'unreachable'
}

/** Whether this failure says anything about the relay being reachable. */
export function isOutage(kind: RelayFailureKind): boolean {
  return kind !== 'not_a_member'
}

/** One line a person can read, per kind. Plain, and never alarming. */
export function describeRelayFailure(kind: RelayFailureKind): string {
  switch (kind) {
    case 'not_a_member':
      return 'You are not a member of this Folder, so its contents are not visible to you.'
    case 'refused':
      return 'The relay refused this read. Showing what was already saved.'
    case 'unreachable':
      return 'Could not reach the relay. Showing what was already saved.'
  }
}
