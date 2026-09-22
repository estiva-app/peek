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
  /** The relay answered, said no *for now*, and said when to ask again. */
  | 'rate_limited'
  /** Not an error: the viewer is not a member of this channel. */
  | 'not_a_member'

/** A relay read that did not produce data, carrying why. */
export class RelayReadError extends Error {
  readonly kind: RelayFailureKind
  readonly reason: string
  /** What the relay said to wait, in ms — see {@link retryAfterMs}. */
  readonly retryAfterMs: number | null

  constructor(reason: string) {
    super(`relay read failed: ${reason}`)
    this.name = 'RelayReadError'
    this.reason = reason
    this.kind = classifyRelayFailure(reason)
    this.retryAfterMs = retryAfterMs(reason)
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
  /*
    Before `refused`, and a kind of its own (FOL-40). A quota rejection is the
    relay working: it answered, promptly, and named the second at which it will
    answer again. Flattened into `unreachable` it read as "the network is
    broken", which is both untrue and, worse, un-actionable — nothing retried,
    because nothing knew there was anything to wait for. The team's unread dot
    lost its live re-read to exactly this and went quiet until the next refresh
    tick. Buzz emits the same sentence over HTTP (`429`) and over the socket
    (`CLOSED`/`NOTICE`), and its own desktop client parses it the same way
    (`extract_retry_in_hint`, `desktop/src-tauri/src/relay.rs`).
  */
  if (text.includes('rate-limited') || text.includes('quota exceeded')) {
    return 'rate_limited'
  }
  if (text.includes('restricted') || text.includes('auth-required') || text.includes('forbidden')) {
    return 'refused'
  }
  return 'unreachable'
}

/** What to wait when the relay says it is limited but not for how long. */
export const RATE_LIMIT_DEFAULT_MS = 10_000

/**
 * The longest a read will sit waiting for a quota window.
 *
 * Not a cap on the relay's authority — a bound on how long a *promise* is worth
 * holding open. Past this the refresh triggers (30 s) have re-read several
 * times over, so a longer wait would resolve with an answer that arrived by
 * another route minutes ago. A hint above it means no retry at all rather than
 * a shortened one: asking again before the window the relay named has rolled
 * over is how a client spends the next window being refused.
 */
export const RATE_LIMIT_MAX_WAIT_MS = 60_000

/** How many quota windows one read will wait out before giving up. */
export const RATE_LIMIT_ATTEMPTS = 2

/**
 * What the relay asked us to wait, in ms, or `null` if it did not ask.
 *
 * Buzz says it in the sentence itself — `rate-limited: quota exceeded; retry in
 * 8s` (`api/bridge.rs`, `connection.rs`) — so **the wait is read, never
 * guessed**: the relay knows when its own window rolls over and a client
 * inventing a backoff either wastes the difference or spends the next window
 * being refused again. The one branch that carries no number is
 * `rate-limited: shared admission unavailable`, a 503 from the shared limiter,
 * and that gets {@link RATE_LIMIT_DEFAULT_MS}.
 *
 * The number is the relay's and the relay is not this app, so it is parsed
 * defensively and its use is bounded by {@link withRateLimitRetry}, not here.
 */
export function retryAfterMs(reason: string): number | null {
  if (classifyRelayFailure(reason) !== 'rate_limited') return null
  const stated = /retry in (\d+)\s*s/i.exec(reason)
  if (!stated) return RATE_LIMIT_DEFAULT_MS
  const seconds = Number.parseInt(stated[1], 10)
  // `0s` means the window has already rolled over; waiting a tick is still
  // right, because the read that would go out now is the one that was refused.
  if (!Number.isFinite(seconds) || seconds <= 0) return RATE_LIMIT_DEFAULT_MS
  return seconds * 1_000
}

/** The relay's own words, out of whatever the read threw. */
function reasonOf(error: unknown): string {
  if (error instanceof RelayReadError) return error.reason
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

/**
 * What a thrown read means, whatever it was thrown as.
 *
 * A read that went through `viewerQuery` throws {@link RelayReadError} and has
 * already classified itself; one that failed before that — `fetch` rejecting,
 * a bug — has only a message. Callers that catch both wrote this out by hand,
 * and a caller that forgot the second half read every network failure as the
 * default.
 */
export function relayFailureKind(error: unknown): RelayFailureKind {
  return error instanceof RelayReadError ? error.kind : classifyRelayFailure(reasonOf(error))
}

/**
 * Run a relay read, waiting out a quota rejection at the time the relay named.
 *
 * **Stateless, and owned by its caller** — no shared scheduler, no module-level
 * gate. Each read waits for its own refusal and nothing coordinates with
 * anything else, which is the whole reason this can be a plain wrapper around
 * the read a hook already had rather than a change to how hooks load.
 *
 * Every other failure is rethrown untouched, on the first attempt: `refused`
 * and `not_a_member` will not change their minds, and `unreachable` is already
 * covered by the refresh triggers underneath every one of these hooks.
 *
 * Read volume — why the quota is being hit at all — is PER-8 and is not this.
 * This only stops a refusal that states its own recovery time from being
 * dropped as if it were a dead network.
 */
export async function withRateLimitRetry<T>(
  read: () => Promise<T>,
  options: {
    attempts?: number
    maxWaitMs?: number
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? RATE_LIMIT_ATTEMPTS
  const maxWaitMs = options.maxWaitMs ?? RATE_LIMIT_MAX_WAIT_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  for (let waited = 0; ; waited += 1) {
    try {
      return await read()
    } catch (error) {
      const wait = retryAfterMs(reasonOf(error))
      if (wait === null || waited >= attempts || wait > maxWaitMs) throw error
      await sleep(wait)
    }
  }
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
    case 'rate_limited':
      return 'The relay is busy right now. Showing what was already saved, and asking again shortly.'
    case 'unreachable':
      return 'Could not reach the relay. Showing what was already saved.'
  }
}
