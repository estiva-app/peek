/**
 * Dual-running merged read state against Convex (CRO-7, step 1).
 *
 * Read state is unusually forgiving to verify and it would be a waste not to
 * exploit that: the merge is a **grow-only CvRDT**, so a wrong implementation
 * converges rather than corrupts, and the worst outcome of a disagreement is a
 * container that reads as unread when it should not. So both are computed, the
 * existing one is rendered, and the difference is recorded on live data before
 * anything is switched.
 *
 * Nothing here renders or writes. The cutover is step 2 and is deliberately not
 * in this change — its own done-when asks for a quiet diff **over a multi-day
 * window**, and there is no honest way to produce that from a single sitting.
 *
 * ## The four classes, and only two of them are worth waking up for
 *
 * | class | meaning |
 * | --- | --- |
 * | `relay-ahead` | read in another app or on another device — **the feature working** |
 * | `local-ahead-recent` | read here moments ago; the debounced publish has not landed |
 * | `local-ahead-persistent` | **investigate** — a publish is being lost, or a context id is being written under the wrong scheme |
 * | regression | **fix before cutover** — the relay frontier moved *backwards*, which the protocol forbids |
 *
 * A regression is the one that cannot be explained away. §11.4 makes the merge a
 * maximum, so a lower value is not merely ignored — it cannot be expressed. Ever
 * seeing one means the merge is wrong, not the data.
 */

/**
 * How long a local-ahead divergence stays benign.
 *
 * The publish queue debounces for 3s and then costs a `/nip44/encrypt`, a
 * `/sign` and a bridge round trip. A minute is generous enough that a slow
 * network never reports a false positive, and short enough that a genuinely
 * lost publish surfaces within one session rather than at the end of the week.
 */
export const PUBLISH_GRACE_SECONDS = 60

export type DivergenceKind = 'relay-ahead' | 'local-ahead-recent' | 'local-ahead-persistent'

export interface ReadStateDivergence {
  context: string
  /** From the Convex cache — what the UI is rendering from today. Seconds. */
  localSeconds?: number
  /** From the merged NIP-RS state. Seconds. */
  relaySeconds?: number
  ahead: 'local' | 'relay'
  deltaSeconds: number
  kind: DivergenceKind
}

/** The relay frontier moved backwards, which §11.4 says is impossible. */
export interface ReadStateRegression {
  context: string
  fromSeconds: number
  toSeconds: number
}

export interface ReadStateDiffReport {
  atMs: number
  localCount: number
  relayCount: number
  divergences: ReadStateDivergence[]
  regressions: ReadStateRegression[]
}

/** Contexts present in one side and not the other, or holding different values. */
export function diffReadState(
  local: Readonly<Record<string, number>>,
  relay: Readonly<Record<string, number>>,
  nowSeconds: number,
  graceSeconds: number = PUBLISH_GRACE_SECONDS,
): ReadStateDivergence[] {
  const out: ReadStateDivergence[] = []
  for (const context of new Set([...Object.keys(local), ...Object.keys(relay)])) {
    const localSeconds = local[context]
    const relaySeconds = relay[context]
    if (localSeconds === relaySeconds) continue

    const localValue = localSeconds ?? -Infinity
    const relayValue = relaySeconds ?? -Infinity
    const ahead = localValue > relayValue ? 'local' : 'relay'
    const deltaSeconds =
      localSeconds === undefined || relaySeconds === undefined
        ? 0
        : Math.abs(localSeconds - relaySeconds)

    let kind: DivergenceKind
    if (ahead === 'relay') {
      kind = 'relay-ahead'
    } else {
      /*
       * A local marker inside the grace window is a publish still in flight.
       * Outside it, the publish has had every chance to land — that is the
       * signal the ticket asks to investigate, and it looks identical to the
       * benign case if you do not check the clock.
       */
      kind =
        localSeconds !== undefined && nowSeconds - localSeconds <= graceSeconds
          ? 'local-ahead-recent'
          : 'local-ahead-persistent'
    }
    out.push({ context, localSeconds, relaySeconds, ahead, deltaSeconds, kind })
  }
  return out.sort((a, b) => a.context.localeCompare(b.context))
}

/**
 * Contexts whose relay value went **down** between two fetches.
 *
 * Compares successive merges rather than local state, because that is where the
 * violation would live: the merge takes a maximum, so its output can only ever
 * grow. A context disappearing is not a regression — it aged out of the horizon,
 * which is what CRO-6's cache exists to cover.
 */
export function detectRegressions(
  previous: Readonly<Record<string, number>> | undefined,
  current: Readonly<Record<string, number>>,
): ReadStateRegression[] {
  if (!previous) return []
  const out: ReadStateRegression[] = []
  for (const [context, before] of Object.entries(previous)) {
    const after = current[context]
    if (after !== undefined && after < before) {
      out.push({ context, fromSeconds: before, toSeconds: after })
    }
  }
  return out.sort((a, b) => a.context.localeCompare(b.context))
}

/** One dual-run comparison, ready to be shown in the debug surface. */
export function buildDiffReport(args: {
  local: Readonly<Record<string, number>>
  relay: Readonly<Record<string, number>>
  previousRelay?: Readonly<Record<string, number>>
  nowMs: number
  graceSeconds?: number
}): ReadStateDiffReport {
  const nowSeconds = Math.floor(args.nowMs / 1000)
  return {
    atMs: args.nowMs,
    localCount: Object.keys(args.local).length,
    relayCount: Object.keys(args.relay).length,
    divergences: diffReadState(args.local, args.relay, nowSeconds, args.graceSeconds),
    regressions: detectRegressions(args.previousRelay, args.relay),
  }
}

/**
 * Is anything here worth a person's attention?
 *
 * The two benign classes are expected and permanent — `relay-ahead` is literally
 * the feature working. A report that counted them would be noise nobody reads,
 * and the ticket is explicit that the cutover gate is "nothing outside the two
 * benign classes".
 */
export function needsAttention(report: ReadStateDiffReport): boolean {
  return (
    report.regressions.length > 0 ||
    report.divergences.some((d) => d.kind === 'local-ahead-persistent')
  )
}
