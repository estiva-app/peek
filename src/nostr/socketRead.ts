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

/** Buzz parses a REQ with more and answers a bare NOTICE — no CLOSED, so the read would only time out. */
export const MAX_FILTERS_PER_REQ = 10
/**
 * REQs this tab sends per {@link WINDOW_MS}, of buzz's 50 per pubkey. The rest
 * is for the live watches, which subscribe outside this pacer (~7 per 5 s while
 * clicking around), and for another tab. At 40, reads plus watches ran at 46–48
 * and the relay refused 22 at its window edges in a 60 s `--hammer`.
 */
export const REQS_PER_WINDOW = 30
export const WINDOW_MS = 5_000
/**
 * A read that has waited this long for a socket slot goes over HTTP instead, a
 * separate meter, while this tab has spilled fewer than
 * {@link HTTP_SPILL_PER_MINUTE} there — well under HTTP's 300, which Ship and
 * every write share. Clicking around fast asks ~50 reads per 5 s, more than
 * either meter allows alone.
 */
export const SPILL_AFTER_MS = 1_000
export const HTTP_SPILL_PER_MINUTE = 120
/** How long a read waits for a socket that is still connecting before it goes over HTTP. */
export const LIVE_WAIT_MS = 3_000
/** A REQ with no EOSE by then is closed and asked again over HTTP. */
export const EOSE_TIMEOUT_MS = 20_000

type Answer = { ok: boolean; events: SignedEvent[]; reason?: string }
type Outcome =
  | { kind: 'events'; events: SignedEvent[] }
  | { kind: 'closed'; reason: string }
  | { kind: 'lost'; why: string }

export interface SocketReaderOptions {
  getClient(relayUrl: string): LiveClient
  /** The pubkey the socket authenticates as, or null when the tab has no credential. */
  currentPubkey(): string | null
  budget: Pick<RelayBudget, 'noteRateLimited' | 'pausedForMs'>
  /** HTTP's own pause (`relayBudget`): a read does not spill there while it is set. */
  httpBudget: Pick<RelayBudget, 'pausedForMs'>
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
): Pacer {
  const sent: number[] = []
  const waiting: { n: number; at: number; resolve: (via: 'socket' | 'http') => void; spillTimer: unknown }[] = []
  let pumpTimer: unknown = null

  function pump() {
    pumpTimer = null
    const floor = now() - windowMs
    while (sent.length > 0 && sent[0] <= floor) sent.shift()
    while (waiting.length > 0) {
      const starved = waiting.findIndex((w) => now() - w.at >= STARVED_AFTER_MS)
      const index = starved === -1 ? waiting.length - 1 : starved
      const next = waiting[index]
      if (sent.length + next.n > perWindow) break
      waiting.splice(index, 1)
      if (next.spillTimer !== null) clearTimer(next.spillTimer)
      const at = now()
      for (let i = 0; i < next.n; i++) sent.push(at)
      next.resolve('socket')
    }
    if (waiting.length > 0 && pumpTimer === null && sent.length > 0) {
      pumpTimer = setTimer(pump, Math.max(0, sent[0] + windowMs - now()))
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
  const pacer = createPacer(REQS_PER_WINDOW, WINDOW_MS, now, setTimer, clearTimer)
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
      sub = client.relay.subscribe(filters, (event) => events.push(event), {
        onEose: () => finish({ kind: 'events', events }),
        onClosed: (reason) => finish({ kind: 'closed', reason }),
      })
      if (done) sub.close()
    })
  }

  async function readChunk(client: LiveClient, filters: Record<string, unknown>[]): Promise<Outcome> {
    if (client.state() !== 'live') return { kind: 'lost', why: client.state() }
    let outcome = await reqOnce(client, filters)
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
    if (filters.length === 0 || options.budget.pausedForMs() > 0) return null
    const socketPubkey = options.currentPubkey()
    if (!socketPubkey || (pubkey && pubkey !== socketPubkey)) return null
    const client = options.getClient(relayUrl)
    if (!(await waitForLive(client))) return null

    const chunks: Record<string, unknown>[][] = []
    for (let i = 0; i < filters.length; i += MAX_FILTERS_PER_REQ) chunks.push(filters.slice(i, i + MAX_FILTERS_PER_REQ))
    // One POST beats a whole window of REQs for a read this wide.
    if (chunks.length > REQS_PER_WINDOW) return null
    if ((await pacer.take(chunks.length, spill)) === 'http') {
      log('socket read spilled to HTTP', { reqs: chunks.length })
      return null
    }
    const outcomes = await Promise.all(chunks.map((chunk) => readChunk(client, chunk)))

    const unanswered = outcomes.find((o) => o.kind === 'lost' || (o.kind === 'closed' && /^(rate-limited|auth-required|error):/.test(o.reason)))
    if (unanswered) {
      log('socket read went over HTTP', { why: 'why' in unanswered ? unanswered.why : 'reason' in unanswered ? unanswered.reason : '' })
      return null
    }
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
    log,
  })
}
