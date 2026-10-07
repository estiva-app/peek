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
import { RATE_LIMIT_DEFAULT_MS } from './relayBudget'

/** Buzz parses a REQ with more and answers a bare NOTICE — no CLOSED, so the read would only time out. */
export const MAX_FILTERS_PER_REQ = 10
/**
 * REQs this tab sends per {@link WINDOW_MS}, of buzz's 50 per pubkey. The rest
 * is for the live watches, which subscribe outside this pacer, and another tab.
 * A read past it waits for a slot rather than being refused.
 */
export const REQS_PER_WINDOW = 40
export const WINDOW_MS = 5_000
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
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  log?: (message: string, detail?: Record<string, unknown>) => void
}

/** At most `perWindow` slots in any `windowMs`, handed out in the order asked. */
export function createPacer(
  perWindow: number,
  windowMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): { slot(): Promise<void> } {
  const sent: number[] = []
  let queue: Promise<void> = Promise.resolve()
  return {
    slot() {
      const turn = queue.then(async () => {
        for (;;) {
          const at = now()
          while (sent.length > 0 && sent[0] <= at - windowMs) sent.shift()
          if (sent.length < perWindow) {
            sent.push(at)
            return
          }
          await sleep(sent[0] + windowMs - at)
        }
      })
      queue = turn
      return turn
    },
  }
}

export function createSocketReader(options: SocketReaderOptions): SocketReader {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const sleep = (ms: number) => new Promise<void>((done) => setTimer(done, ms))
  const log = options.log ?? (() => {})
  const pacer = createPacer(REQS_PER_WINDOW, WINDOW_MS, now, sleep)

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
    await pacer.slot()
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
    log,
  })
}
