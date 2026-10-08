/**
 * Relay reads over the tab's open connection (OPT-2).
 *
 * Every `POST /query` costs an Estiva ID `/sign` first, for its NIP-98 auth,
 * and buzz's replay guard refuses a reused auth event, so the signature cannot
 * be cached: two round trips per read, against a bucket of 300 a minute per
 * pubkey that Ship draws on too. On 7 Oct Katerina clicked through topics
 * quickly and the relay refused 57 of her reads in a minute; the switch probe's
 * `--hammer 60` reproduced it on production (379 reads, 96 refused).
 *
 * The socket is authenticated once (NIP-42), so a read there is one REQ, closed
 * at EOSE. Same NIP-01 filters, same answer: buzz resolves channel access per
 * REQ with the same membership check as `/query`, and plain filters take the
 * same query (the bridge's window and feed clamps need extension flags Peek
 * never sends). What changes is the meter — a REQ is one frame of 50 per 5 s
 * per pubkey (`connection.rs` `enforce_ws_admission`); CLOSE is free.
 *
 * HTTP stays the path for anything the socket cannot answer properly: no
 * socket within {@link LIVE_WAIT_MS}, a different pubkey, the socket's own
 * quota paused, or a REQ that never finishes. Returning `null` says so.
 */
import type { LiveClient } from '@estiva-app/platform'
import { createRelayBudget, type BudgetChannel, type RelayBudget } from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'
import { validToken } from '@/auth/estivaId'
import type { SocketReader } from './bridge'
import { getLiveClient } from './liveTopics'
import { recordRelayRequest, refusalOf } from './relayMeter'
import { RATE_LIMIT_DEFAULT_MS, relayBudget } from './relayBudget'
import { otherFramesSince, sendingAsRead, SHAPED_WINDOW_MS, WINDOW_MS } from './socketFrames'

/** Buzz parses a REQ with more and answers a bare NOTICE — no CLOSED, so the read would only time out. */
export const MAX_FILTERS_PER_REQ = 10
/**
 * Metered frames this tab sends per {@link WINDOW_MS}, of buzz's 50 per pubkey,
 * counting the live watches' (`socketFrames.ts`, ~7 per 5 s while clicking
 * around) as well as the reads. The rest is slack for network jitter against
 * buzz's fixed windows. Uncounted, a read cap of 40 ran at 46–48 with the
 * watches and the relay refused 22 at its window edges in a 60 s `--hammer`.
 */
export const REQS_PER_WINDOW = 45
export { WINDOW_MS }
/**
 * A read that has waited this long for a socket slot goes over HTTP instead, a
 * separate meter, while this tab has spilled fewer than
 * {@link HTTP_SPILL_PER_MINUTE} there — well under HTTP's 300, which Ship and
 * every write share. Clicking around fast asks ~50 reads per 5 s, more than
 * either meter allows alone. Boot (~60 REQs) and the first topic open (~50)
 * also ask more than a window: kept on the socket, that open took 7.5 s, not
 * 3.0 s; spilling costs it ~1 /sign (Miky, OPT-2, 2026-10-08).
 */
export const SPILL_AFTER_MS = 1_000
export const HTTP_SPILL_PER_MINUTE = 120
/** How long a read waits for a socket that is still connecting before it goes over HTTP. */
export const LIVE_WAIT_MS = 3_000
/**
 * A REQ with no EOSE by then is closed and asked again over HTTP. Buzz ends a
 * REQ with no EOSE at all when its send buffer to this tab is full (`req.rs`,
 * `if !conn.send(msg) { return }`); the slowest answered read under the
 * `--hammer` took 6.5 s.
 */
export const EOSE_TIMEOUT_MS = 10_000
/**
 * REQs answering at once. Buzz queues at most 1,000 frames to a connection —
 * one per event — and drops the connection after 15 sends in a row find the
 * queue full, which a busy tab (not reading its socket while it renders) and a
 * few wide reads arriving together reached in the v5 switch probe.
 */
export const MAX_REQS_IN_FLIGHT = 4

type Answer = { ok: boolean; events: SignedEvent[]; reason?: string }
type Outcome =
  | { kind: 'events'; events: SignedEvent[] }
  | { kind: 'closed'; reason: string }
  | { kind: 'lost'; why: string }

export interface SocketReaderOptions {
  /** The tab's live client for `relayUrl`, or null when the tab's socket is another relay's. */
  getClient(relayUrl: string): LiveClient | null
  /** The pubkey the socket authenticates as, or null when the tab has no credential. */
  currentPubkey(): string | null
  budget: Pick<RelayBudget, 'noteRateLimited' | 'pausedForMs'>
  /** HTTP's own pause (`relayBudget`): a read does not spill there while it is set. */
  httpBudget: Pick<RelayBudget, 'pausedForMs'>
  /** Metered frames the socket sent outside this reader since `floor`, oldest first. */
  otherFrames?: (floor: number) => number[]
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  log?: (message: string, detail?: Record<string, unknown>) => void
}

export interface Pacer {
  /**
   * `n` slots at once (one read's REQs), or `'http'` when the read waited
   * `spill.afterMs` and `spill.allowed()` said HTTP may take it. `n` must not
   * exceed the window.
   */
  take(n: number, spill?: { afterMs: number; allowed(): boolean }): Promise<'socket' | 'http'>
}

/**
 * A read waiting longer than this goes ahead of newer ones. Newest-first alone
 * starved the read that draws the side tree through a whole `--hammer` minute:
 * its topic links never came back.
 */
export const STARVED_AFTER_MS = 3_000

/**
 * At most `perWindow` slots in any `windowMs`, newest asker first — the reads
 * still waiting while someone clicks on are for what they have left, and the
 * ones for what is on screen should not queue behind them — except that a read
 * waiting past {@link STARVED_AFTER_MS} goes first, oldest of those first.
 */
export function createPacer(
  perWindow: number,
  windowMs: number,
  now: () => number,
  setTimer: (fn: () => void, ms: number) => unknown,
  clearTimer: (handle: unknown) => void,
  /** Metered frames sent outside the pacer since `floor`, oldest first (the live watches). */
  others: (floor: number) => number[] = () => [],
): Pacer {
  const sent: number[] = []
  const waiting: { n: number; at: number; resolve: (via: 'socket' | 'http') => void; spillTimer: unknown }[] = []
  let pumpTimer: unknown = null

  function pump() {
    if (pumpTimer !== null) clearTimer(pumpTimer)
    pumpTimer = null
    const floor = now() - windowMs
    while (sent.length > 0 && sent[0] <= floor) sent.shift()
    const outside = others(floor)
    while (waiting.length > 0) {
      const starved = waiting.findIndex((w) => now() - w.at >= STARVED_AFTER_MS)
      const index = starved === -1 ? waiting.length - 1 : starved
      const next = waiting[index]
      if (sent.length + outside.length + next.n > perWindow) break
      waiting.splice(index, 1)
      if (next.spillTimer !== null) clearTimer(next.spillTimer)
      const at = now()
      for (let i = 0; i < next.n; i++) sent.push(at)
      next.resolve('socket')
    }
    // Wake when the oldest counted frame leaves the window.
    const oldest = Math.min(sent[0] ?? Infinity, outside[0] ?? Infinity)
    if (waiting.length > 0 && oldest !== Infinity) {
      pumpTimer = setTimer(pump, Math.max(0, oldest + windowMs - now()))
    }
  }

  return {
    take(n, spill) {
      return new Promise((resolve) => {
        const waiter = { n, at: now(), resolve, spillTimer: null as unknown }
        // Asked again every `afterMs` while it waits: HTTP may have room later.
        const trySpill = () => {
          const i = waiting.indexOf(waiter)
          if (i === -1 || !spill) return
          if (!spill.allowed()) {
            waiter.spillTimer = setTimer(trySpill, spill.afterMs)
            return
          }
          waiting.splice(i, 1)
          resolve('http')
        }
        if (spill) waiter.spillTimer = setTimer(trySpill, spill.afterMs)
        waiting.push(waiter)
        pump()
      })
    },
  }
}

export function createSocketReader(options: SocketReaderOptions): SocketReader {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const log = options.log ?? (() => {})
  const pacer = createPacer(REQS_PER_WINDOW, SHAPED_WINDOW_MS, now, setTimer, clearTimer, options.otherFrames)
  let inFlight = 0
  const slotFreed: (() => void)[] = []
  async function inFlightSlot(): Promise<() => void> {
    while (inFlight >= MAX_REQS_IN_FLIGHT) await new Promise<void>((resolve) => slotFreed.push(resolve))
    inFlight += 1
    return () => {
      inFlight -= 1
      slotFreed.shift()?.()
    }
  }
  const spilled: number[] = []
  const spill = {
    afterMs: SPILL_AFTER_MS,
    allowed() {
      const floor = now() - 60_000
      while (spilled.length > 0 && spilled[0] <= floor) spilled.shift()
      if (spilled.length >= HTTP_SPILL_PER_MINUTE || options.httpBudget.pausedForMs() > 0) return false
      spilled.push(now())
      return true
    },
  }

  function waitForLive(client: LiveClient): Promise<boolean> {
    const state = client.state()
    if (state === 'live') return Promise.resolve(true)
    if (state === 'failed') return Promise.resolve(false)
    return new Promise((resolve) => {
      const timer = setTimer(() => finish(false), LIVE_WAIT_MS)
      const stop = client.onState((next) => {
        if (next === 'live') finish(true)
        else if (next === 'failed') finish(false)
      })
      function finish(live: boolean) {
        clearTimer(timer)
        stop()
        resolve(live)
      }
    })
  }

  /** One REQ, closed at EOSE. A subscription left open would be re-sent on every reconnect. */
  function reqOnce(client: LiveClient, filters: Record<string, unknown>[]): Promise<Outcome> {
    return new Promise((resolve) => {
      const events: SignedEvent[] = []
      let done = false
      let sub: { close(): void } | null = null
      const finish = (outcome: Outcome) => {
        if (done) return
        done = true
        clearTimer(timer)
        stopState()
        sub?.close()
        resolve(outcome)
      }
      const timer = setTimer(() => finish({ kind: 'lost', why: 'no EOSE' }), EOSE_TIMEOUT_MS)
      // Leaving `live` means the REQ may never be answered, and the relay would
      // be sent it again on reconnect; HTTP answers it now instead.
      const stopState = client.onState((state) => {
        if (state !== 'live') finish({ kind: 'lost', why: state })
      })
      sub = sendingAsRead(() =>
        client.relay.subscribe(filters, (event) => events.push(event), {
          onEose: () => finish({ kind: 'events', events }),
          onClosed: (reason) => finish({ kind: 'closed', reason }),
        }),
      )
      if (done) sub.close()
    })
  }

  async function readChunk(client: LiveClient, filters: Record<string, unknown>[]): Promise<Outcome> {
    const release = await inFlightSlot()
    let outcome: Outcome
    try {
      if (client.state() !== 'live') return { kind: 'lost', why: client.state() }
      outcome = await reqOnce(client, filters)
    } finally {
      release()
    }
    // A REQ naming only Folders the reader is not in is CLOSED; `/query` answers
    // the same filters `200 []` (`repair_requested_channel_access` just leaves
    // them out). The callers were written against the second.
    if (outcome.kind === 'closed' && outcome.reason.startsWith('restricted: not a channel member')) {
      outcome = { kind: 'events', events: [] }
    }
    const refusal = outcome.kind === 'closed' ? refusalOf(0, outcome.reason) : null
    recordRelayRequest('REQ', filters, refusal)
    // Only a quota refusal pauses the socket's reads; "too many concurrent
    // requests" is the relay's own load, and the next read may well get in.
    if (outcome.kind === 'closed' && /quota exceeded/.test(outcome.reason)) options.budget.noteRateLimited(outcome.reason)
    return outcome
  }

  return async (relayUrl, filters, pubkey) => {
    const asked = now()
    const note = (via: string, at: Partial<SocketReadRecord> = {}) =>
      recordSocketRead({ at: asked, reqs: 0, liveWaitMs: 0, pacerWaitMs: 0, answerMs: 0, via, ...at })
    const overHttp = (why: string, at: Partial<SocketReadRecord> = {}) => {
      note(`http: ${why}`, at)
      return null
    }
    if (filters.length === 0) return null
    if (options.budget.pausedForMs() > 0) return overHttp('socket paused')
    const socketPubkey = options.currentPubkey()
    if (!socketPubkey || (pubkey && pubkey !== socketPubkey)) return overHttp('other pubkey')
    const client = options.getClient(relayUrl)
    if (!client) return overHttp('other relay')
    const live = await waitForLive(client)
    const liveWaitMs = now() - asked
    if (!live) return overHttp('not live', { liveWaitMs })

    const chunks: Record<string, unknown>[][] = []
    for (let i = 0; i < filters.length; i += MAX_FILTERS_PER_REQ) chunks.push(filters.slice(i, i + MAX_FILTERS_PER_REQ))
    const reqs = chunks.length
    // One POST beats a whole window of REQs for a read this wide.
    if (reqs > REQS_PER_WINDOW) return overHttp('too wide', { reqs, liveWaitMs })
    const via = await pacer.take(reqs, spill)
    const pacerWaitMs = now() - asked - liveWaitMs
    if (via === 'http') {
      log('socket read spilled to HTTP', { reqs })
      return overHttp('spilled', { reqs, liveWaitMs, pacerWaitMs })
    }
    const outcomes = await Promise.all(chunks.map((chunk) => readChunk(client, chunk)))
    const timing = { reqs, liveWaitMs, pacerWaitMs, answerMs: now() - asked - liveWaitMs - pacerWaitMs }

    const unanswered = outcomes.find((o) => o.kind === 'lost' || (o.kind === 'closed' && /^(rate-limited|auth-required|error):/.test(o.reason)))
    if (unanswered) {
      const why = 'why' in unanswered ? unanswered.why : 'reason' in unanswered ? unanswered.reason : ''
      log('socket read went over HTTP', { why })
      return overHttp(why.split(';')[0], timing)
    }
    note('socket', timing)
    // Anything else CLOSED is the relay's answer to these filters (`restricted:`,
    // `blocked:`), the same verdict `/query` gives with a 4xx.
    const closed = outcomes.find((o): o is Extract<Outcome, { kind: 'closed' }> => o.kind === 'closed')
    if (closed) return { ok: false, events: [], reason: closed.reason } satisfies Answer

    const seen = new Set<string>()
    const events: SignedEvent[] = []
    for (const outcome of outcomes) {
      if (outcome.kind !== 'events') continue
      for (const event of outcome.events) {
        if (seen.has(event.id)) continue
        seen.add(event.id)
        events.push(event)
      }
    }
    return { ok: true, events } satisfies Answer
  }
}

function otherTabs(): BudgetChannel | undefined {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return undefined
  return new window.BroadcastChannel('peek-socket-budget')
}

/**
 * The socket's own pause, apart from `relayBudget`'s: the two are different
 * meters on the relay, and a refusal on one says nothing about the other — HTTP
 * is exactly where a read goes while the socket's is spent.
 */
export const socketBudget = createRelayBudget({ defaultBackoffMs: RATE_LIMIT_DEFAULT_MS, channel: otherTabs() })

/** Called once at boot (`main.tsx`). */
export function createAppSocketReader(log?: SocketReaderOptions['log']): SocketReader {
  return createSocketReader({
    getClient: getLiveClient,
    currentPubkey: () => validToken()?.pubkey ?? null,
    budget: socketBudget,
    httpBudget: relayBudget,
    otherFrames: otherFramesSince,
    log,
  })
}

/** One read the reader was asked for: where it waited, and how it was answered. */
export interface SocketReadRecord {
  at: number
  reqs: number
  liveWaitMs: number
  pacerWaitMs: number
  answerMs: number
  /** `socket`, or `http: <why>`. */
  via: string
}

const reads: SocketReadRecord[] = []

export function recordSocketRead(record: SocketReadRecord): void {
  reads.push(record)
  if (reads.length > 2_000) reads.splice(0, reads.length - 2_000)
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/** `window.__socketReads(minutes?)`: the reads of the last minute(s), by route, with where they waited. */
export function socketReads(minutes = 1, at: number = Date.now()) {
  const recent = reads.filter((r) => r.at > at - minutes * 60_000)
  const byVia: Record<string, number> = {}
  for (const r of recent) byVia[r.via] = (byVia[r.via] ?? 0) + 1
  const waits = (pick: (r: SocketReadRecord) => number, of = recent) => ({
    p50: percentile(of.map(pick), 0.5),
    p90: percentile(of.map(pick), 0.9),
    max: percentile(of.map(pick), 1),
  })
  const overSocket = recent.filter((r) => r.via === 'socket')
  return {
    reads: recent.length,
    reqs: overSocket.reduce((sum, r) => sum + r.reqs, 0),
    byVia,
    liveWaitMs: waits((r) => r.liveWaitMs),
    pacerWaitMs: waits((r) => r.pacerWaitMs),
    answerMs: waits((r) => r.answerMs, overSocket),
    recent: recent.slice(-40),
  }
}

export function installSocketReadsDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__socketReads = (minutes?: number) =>
    socketReads(typeof minutes === 'number' && minutes > 0 ? minutes : 1)
}
