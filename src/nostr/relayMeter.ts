/**
 * How many requests this tab spends against the relay's meter (PER-8).
 *
 * Buzz meters `POST /query` **per request**, before it parses a single filter,
 * at 300 a minute per pubkey — shared with every other Estiva tab the person
 * has open. So the number that decides whether a read is refused is not how
 * many filters or events a hook asks for, it is how many times the tab posts,
 * and nothing in Peek counted that. FOL-40 was chased through three PRs as a
 * broken subscription when the answer was a read refused for quota, and the
 * read volume that caused it was a list of hooks written out by hand in the
 * ticket rather than a measurement.
 *
 * `window.__relayReads()` is the measurement: every request `bridgePost` sent
 * in the last minute (or `__relayReads(5)` for five), grouped by the shape of
 * what it asked. Leave a tab idle and in front for a few minutes, then call it.
 *
 * ## Labelled by shape, not by caller
 *
 * A caller would be the better label, and the production bundle has none to
 * give — its stack frames are minified. The filters are what the relay sees
 * anyway, and each hook's read has a shape of its own: the dots are `9,1111
 * #h×N`, a Folder's listing asks by `#h` and then by `#a`, follows is a single
 * `30000` filter. A shape that appears twice as often as it should is the
 * finding.
 *
 * Browser-side only: a Convex action that reads the relay as the person spends
 * the same meter and is not counted here.
 */

/**
 * Why the relay refused a request, when it did.
 *
 * Buzz says `rate-limited:` for two different things (`api/bridge.rs`
 * `enforce_http_admission`): `429 … quota exceeded` when this pubkey spent its
 * 300 in the window, and `503 … shared admission unavailable` when the relay
 * could not reach its own counter. The first is traffic, the second an outage,
 * and the meter used to count both as the first.
 */
export type Refusal = 'quota' | 'unavailable'

/** The refusal an answer carries, or `null` for one the meter should not flag. */
export function refusalOf(status: number, text: string): Refusal | null {
  // An answer is not a refusal, whatever it says. The body of a 200 is events,
  // and events are people's words: PER-12's own issue and comments say
  // "rate-limited" and "unavailable", so every read that returned them was
  // counted as refused — 17 of them in one 15-minute window, at seconds when
  // the relay's log shows nothing but 200s.
  if (status >= 200 && status < 300) return null
  if (status === 429) return 'quota'
  if (!/rate-limited/i.test(text)) return null
  return status === 503 || /unavailable/i.test(text) ? 'unavailable' : 'quota'
}

/** One request, as the meter remembers it. */
export interface RelayRequest {
  at: number
  path: string
  label: string
  refusal: Refusal | null
}

/** What `window.__relayReads()` answers. */
export interface RelayReadsSnapshot {
  /** The window asked about, in minutes. */
  minutes: number
  /** Whether the log reaches back that far; `false` means the tab is younger. */
  covered: boolean
  total: number
  perMinute: number
  /** Refused for quota: this pubkey's 300 a minute, spent by every client it signs. */
  rateLimited: number
  /** Refused because the relay could not reach its own counter. */
  unavailable: number
  /**
   * Every refused request, oldest first: the local time, why, and what it asked.
   * The time is what lines a refusal up with a burst seen elsewhere — another
   * tab, a script, the relay's counters — since this tab's own reads rarely
   * reach 300 a minute on their own.
   */
  refused: { at: string; refusal: Refusal; shape: string }[]
  /** Busiest shape first. */
  byShape: { shape: string; count: number; perMinute: number }[]
}

/** Longer than anybody will ask about; the log is trimmed to it. */
const KEEP_MS = 15 * 60_000

const log: RelayRequest[] = []
let startedAt = Date.now()

/**
 * The shape of one request: which kinds, which tags, how many filters.
 *
 * `9,1111 #h×107` is one POST carrying 107 filters of that shape. Filters of
 * different shapes in one request are listed with `+`, in the order sent.
 */
export function shapeOf(path: string, payload: unknown): string {
  // A read over the socket (OPT-2) spends the socket's meter, not this one's
  // 300 a minute, so it is labelled apart.
  if (path === 'REQ') return `socket ${shapeOf('/query', payload)}`
  if (path !== '/query') {
    const kind = (payload as { kind?: unknown } | null)?.kind
    return `${path.replace(/^\//, '')}${typeof kind === 'number' ? ` ${kind}` : ''}`
  }
  if (!Array.isArray(payload)) return 'query ?'
  const runs: { shape: string; count: number }[] = []
  for (const filter of payload as Record<string, unknown>[]) {
    const kinds = Array.isArray(filter.kinds) ? [...(filter.kinds as number[])].sort((a, b) => a - b).join(',') : '*'
    const keys = Object.keys(filter)
      .filter((key) => key.startsWith('#') || key === 'authors' || key === 'ids')
      .sort()
    const shape = [kinds, ...keys].join(' ')
    // Not `.at(-1)`: `bridge.ts` is imported by Convex functions, whose typecheck
    // (`tsc -p convex`) is ES2021.
    const last = runs[runs.length - 1]
    if (last?.shape === shape) last.count += 1
    else runs.push({ shape, count: 1 })
  }
  return runs.map((run) => (run.count > 1 ? `${run.shape}×${run.count}` : run.shape)).join(' + ')
}

/** Called by `bridgePost` for every request it sends, and by `socketRead` for every REQ, whatever the answer. */
export function recordRelayRequest(path: string, payload: unknown, refusal: Refusal | null, at: number = Date.now()): void {
  log.push({ at, path, label: shapeOf(path, payload), refusal })
  const floor = at - KEEP_MS
  let drop = 0
  while (drop < log.length && log[drop].at < floor) drop += 1
  if (drop > 0) log.splice(0, drop)
}

/** The last `minutes` of requests, summarised. */
export function relayReads(minutes = 1, now: number = Date.now()): RelayReadsSnapshot {
  const since = now - minutes * 60_000
  const inWindow = log.filter((request) => request.at >= since)
  const counts = new Map<string, number>()
  for (const request of inWindow) counts.set(request.label, (counts.get(request.label) ?? 0) + 1)
  const perMinute = (n: number) => Math.round((n / minutes) * 10) / 10
  return {
    minutes,
    covered: startedAt <= since,
    total: inWindow.length,
    perMinute: perMinute(inWindow.length),
    rateLimited: inWindow.filter((request) => request.refusal === 'quota').length,
    unavailable: inWindow.filter((request) => request.refusal === 'unavailable').length,
    refused: inWindow.flatMap(({ at, refusal, label }) =>
      refusal ? [{ at: new Date(at).toLocaleTimeString(), refusal, shape: label }] : [],
    ),
    byShape: [...counts]
      .map(([shape, count]) => ({ shape, count, perMinute: perMinute(count) }))
      .sort((a, b) => b.count - a.count),
  }
}

/** Tests only: forget everything, and start the clock again. */
export function resetRelayMeter(at: number = Date.now()): void {
  log.length = 0
  startedAt = at
}

/** `window.__relayReads(minutes?)` — see the module doc. */
export function installRelayReadsDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__relayReads = (minutes?: number) =>
    relayReads(typeof minutes === 'number' && minutes > 0 ? minutes : 1)
}
