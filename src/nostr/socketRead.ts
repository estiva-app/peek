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
import {
  createInFlight,
  createPacer,
  createRelayBudget,
  matchesSnapshotFilter,
  type BudgetChannel,
  type ReadLane,
  type RelayBudget,
  type SnapshotFilter,
} from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'
import { validToken } from '@/auth/estivaId'
import type { QueryLane, SocketReader } from './bridge'
import { getLiveClient } from './liveTopics'
import { recordRelayRequest, refusalOf } from './relayMeter'
import { RATE_LIMIT_DEFAULT_MS, relayBudget } from './relayBudget'
import { otherFramesSince, readingFirst, sendingAsRead, sendingFirst, SHAPED_WINDOW_MS, WINDOW_MS } from './socketFrames'

/** Buzz parses a REQ with more and answers a bare NOTICE — no CLOSED, so the read would only time out. */
export const MAX_FILTERS_PER_REQ = 10
/**
 * Metered frames this tab sends per {@link WINDOW_MS}, of buzz's 50 per pubkey,
 * counting the live watches' (`socketFrames.ts`, ~7 per 5 s while clicking
 * around) as well as the reads. Uncounted, a read cap of 40 ran at 46–48 with
 * the watches and the relay refused 22 at its window edges in a 60 s `--hammer`.
 * The 50 are the person's, across every socket: the rest is left for Ship and
 * other tabs, whose watches are refused silently when it runs out (Miky, OPT-2,
 * 2026-10-08).
 */
export const REQS_PER_WINDOW = 40
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

/** A CLOSED that says nothing about the filters — the socket's state, or the relay's — so it is retried over HTTP. */
const TRANSIENT = /^(rate-limited|auth-required|error):/

/** NIP-01's fields that `matchesSnapshotFilter` judges exactly: a read asking only these can share a REQ (PEE-5). */
const PACKABLE = new Set(['ids', 'kinds', 'authors', 'since', 'until', 'limit'])

function packable(filters: Record<string, unknown>[]): boolean {
  return filters.every((filter) => Object.keys(filter).every((key) => PACKABLE.has(key) || /^#.$/.test(key)))
}

/** What the relay would have answered `filters` alone, out of a shared REQ's events: per filter, its matches, newest first, at most its `limit`. */
export function answerOf(filters: Record<string, unknown>[], events: SignedEvent[]): SignedEvent[] {
  const seen = new Set<string>()
  const answer: SignedEvent[] = []
  for (const filter of filters) {
    const matching = events
      .filter((event) => matchesSnapshotFilter(filter as SnapshotFilter, event))
      .sort((a, b) => b.created_at - a.created_at)
    const limit = typeof filter.limit === 'number' ? filter.limit : matching.length
    for (const event of matching.slice(0, limit)) {
      if (seen.has(event.id)) continue
      seen.add(event.id)
      answer.push(event)
    }
  }
  return answer
}
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

/**
 * Slots of each window a read loaded ahead leaves for clicks (PEE-5): Peek's
 * loader from Desk takes at most `REQS_PER_WINDOW` less this, and only while
 * no click is waiting (`@estiva-app/platform`'s `createPacer`, lane `ahead`).
 */
export const AHEAD_RESERVE = 15
/**
 * Of {@link HTTP_SPILL_PER_MINUTE}, how many a read loaded ahead may take after
 * waiting {@link SPILL_AFTER_MS} (PEE-5). Desk's own reads fill the socket's
 * windows for its first ~7 s, so on the socket alone the loader's first read went
 * out ~5 s after it was asked; HTTP had room (Desk spilled 5 of 120). A quarter,
 * so a click's spill always finds the rest.
 */
export const AHEAD_HTTP_PER_MINUTE = 30

/** A {@link SocketReader} that can also move the reads loaded ahead into the click lane, and say what waits. */
export type LanedSocketReader = SocketReader & {
  promoteAhead(): void
  waiting(): {
    pacer: { click: number; ahead: number }
    inFlight: { click: number; ahead: number }
    waiting: { click: number; ahead: number }
  }
}

export function createSocketReader(options: SocketReaderOptions): LanedSocketReader {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const log = options.log ?? (() => {})
  const pacer = createPacer({
    perWindow: REQS_PER_WINDOW,
    windowMs: SHAPED_WINDOW_MS,
    reserve: AHEAD_RESERVE,
    now,
    timers: { setTimeout: setTimer, clearTimeout: clearTimer },
    others: options.otherFrames,
  })
  const inFlight = createInFlight(MAX_REQS_IN_FLIGHT)
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
  const aheadSpilled: number[] = []
  /** `extra` more reads going over HTTP with the one asked about: a pack's others. */
  const aheadSpill = {
    afterMs: SPILL_AFTER_MS,
    allowed(extra = 0) {
      const floor = now() - 60_000
      while (aheadSpilled.length > 0 && aheadSpilled[0] <= floor) aheadSpilled.shift()
      while (spilled.length > 0 && spilled[0] <= floor) spilled.shift()
      if (aheadSpilled.length + 1 + extra > AHEAD_HTTP_PER_MINUTE || spilled.length + 1 + extra > HTTP_SPILL_PER_MINUTE) return false
      if (options.httpBudget.pausedForMs() > 0) return false
      for (let i = 0; i <= extra; i++) {
        aheadSpilled.push(now())
        spilled.push(now())
      }
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
  function reqOnce(client: LiveClient, filters: Record<string, unknown>[], first = false): Promise<Outcome> {
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
      const subscribe = () =>
        sendingAsRead(() =>
          client.relay.subscribe(filters, (event) => events.push(event), {
            onEose: () => finish({ kind: 'events', events }),
            onClosed: (reason) => finish({ kind: 'closed', reason }),
          }),
        )
      sub = first ? sendingFirst(subscribe) : subscribe()
      if (done) sub.close()
    })
  }

  async function readChunk(client: LiveClient, filters: Record<string, unknown>[], lane: QueryLane): Promise<Outcome> {
    // A first page takes no slot (PEE-7): it is two or three REQs, and the slots are held by reads the frame shaper
    // keeps waiting for it.
    if (lane === 'first') return reqInSlot(client, filters, () => {}, true)
    return reqInSlot(client, filters, await inFlight.acquire(lane))
  }

  /*
    Reads loaded ahead share REQs (PEE-5). The relay meters frames, not
    filters, and what Desk's loader asks is mostly one-filter reads — a
    profile, an app's manifest — that a REQ of their own would spend a whole
    slot on. Each waits here; when the pacer grants the `ahead` lane a slot,
    everything waiting then goes out as one REQ of at most ten distinct
    filters, and each read is handed what its own filters match, at most each
    filter's `limit`, newest first — what the relay would have answered it.
  */
  type Pack = { client: LiveClient; filters: Record<string, unknown>[]; promoted: boolean; resolve: (outcome: Outcome | 'alone' | 'http') => void }
  const packs: Pack[] = []
  let packing = false

  function readPacked(client: LiveClient, filters: Record<string, unknown>[]): Promise<Outcome | 'alone' | 'http'> {
    return new Promise((resolve) => {
      packs.push({ client, filters, promoted: false, resolve })
      void pumpPacks()
    })
  }

  /** The reads at the front that go out as one REQ, and their filters. */
  function frontPack(): { pack: Pack[]; merged: Map<string, Record<string, unknown>> } {
    const client = packs[0].client
    const merged = new Map<string, Record<string, unknown>>()
    let count = 0
    for (; count < packs.length && packs[count].client === client; count++) {
      const keys = packs[count].filters.map((filter) => JSON.stringify(filter))
      const fresh = new Set(keys.filter((key) => !merged.has(key))).size
      if (count > 0 && merged.size + fresh > MAX_FILTERS_PER_REQ) break
      packs[count].filters.forEach((filter, i) => merged.set(keys[i], filter))
    }
    return { pack: packs.slice(0, count), merged }
  }

  async function pumpPacks() {
    if (packing) return
    packing = true
    try {
      while (packs.length > 0) {
        // Asked for as the person's own once they have acted: a click may be waiting on one of these.
        const lane: ReadLane = packs[0].promoted ? 'click' : 'ahead'
        // Over HTTP, each read of the pack goes as its own POST, so each counts against the allowance.
        let spilling = 0
        const packSpill = {
          afterMs: SPILL_AFTER_MS,
          allowed: () => {
            const size = frontPack().pack.length
            const ok = lane === 'click' ? spill.allowed() : aheadSpill.allowed(size - 1)
            if (ok) spilling = lane === 'click' ? 1 : size
            return ok
          },
        }
        if ((await pacer.take(1, { lane, spill: packSpill })) === 'http') {
          for (const read of packs.splice(0, spilling)) read.resolve('http')
          continue
        }
        const release = await inFlight.acquire(lane)
        const { pack, merged } = frontPack()
        packs.splice(0, pack.length)
        void reqInSlot(pack[0].client, [...merged.values()], release).then((outcome) => {
          for (const read of pack) {
            if (outcome.kind === 'events') read.resolve({ kind: 'events', events: answerOf(read.filters, outcome.events) })
            // The relay's verdict on one filter is not the others': each is asked again alone.
            else if (pack.length > 1 && outcome.kind === 'closed' && !TRANSIENT.test(outcome.reason)) read.resolve('alone')
            else read.resolve(outcome)
          }
        })
      }
    } finally {
      packing = false
    }
  }

  async function reqInSlot(client: LiveClient, filters: Record<string, unknown>[], release: () => void, first = false): Promise<Outcome> {
    let outcome: Outcome
    try {
      if (client.state() !== 'live') return { kind: 'lost', why: client.state() }
      outcome = await reqOnce(client, filters, first)
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

  const read: SocketReader = async (relayUrl, filters, pubkey, { lane = 'click' } = {}) => {
    const asked = now()
    const note = (via: string, at: Partial<SocketReadRecord> = {}) =>
      recordSocketRead({ at: asked, reqs: 0, liveWaitMs: 0, pacerWaitMs: 0, answerMs: 0, via, lane, ...at })
    // A read loaded ahead goes over HTTP, whose meter Ship and every write
    // share, only when it waited and its own smaller allowance let it
    // (`AHEAD_HTTP_PER_MINUTE`): whatever else would send it there fails it,
    // and the loader stops.
    const overHttp = (why: string, at: Partial<SocketReadRecord> = {}): Answer | null => {
      if (lane === 'ahead' && why !== 'spilled') {
        note(`refused ahead: ${why}`, at)
        return { ok: false, events: [], reason: `ahead: ${why}` }
      }
      note(`http: ${why}`, at)
      return null
    }
    if (filters.length === 0) return lane === 'ahead' ? { ok: true, events: [] } : null
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
    if (reqs > (lane === 'ahead' ? REQS_PER_WINDOW - AHEAD_RESERVE : REQS_PER_WINDOW)) return overHttp('too wide', { reqs, liveWaitMs })
    let outcomes: Outcome[] | null = null
    let pacerWaitMs = 0
    if (lane === 'ahead' && reqs === 1 && packable(filters)) {
      const packed = await readPacked(client, filters)
      if (packed === 'http') return overHttp('spilled', { reqs, liveWaitMs, pacerWaitMs: now() - asked - liveWaitMs })
      if (packed !== 'alone') outcomes = [packed]
    }
    if (!outcomes) {
      if (lane === 'first') {
        // Past the pacer, which counts its frames as others' (PEE-7): the shaper keeps it room, and the cap is the shaper's.
        const answered = readingFirst(now)
        try {
          outcomes = await Promise.all(chunks.map((chunk) => readChunk(client, chunk, lane)))
        } finally {
          answered()
        }
      } else {
        const via = await pacer.take(reqs, { lane, spill: lane === 'ahead' ? aheadSpill : spill })
        pacerWaitMs = now() - asked - liveWaitMs
        if (via === 'http') {
          log('socket read spilled to HTTP', { reqs })
          return overHttp('spilled', { reqs, liveWaitMs, pacerWaitMs })
        }
        outcomes = await Promise.all(chunks.map((chunk) => readChunk(client, chunk, lane)))
      }
    }
    const timing = { reqs, liveWaitMs, pacerWaitMs, answerMs: now() - asked - liveWaitMs - pacerWaitMs }

    const unanswered = outcomes.find((o) => o.kind === 'lost' || (o.kind === 'closed' && TRANSIENT.test(o.reason)))
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
  return Object.assign(read, {
    promoteAhead: () => {
      for (const waiting of packs) waiting.promoted = true
      pacer.promote()
    },
    waiting: () => ({ pacer: pacer.waiting(), ...inFlight.state() }),
  })
}

/** The reader `main.tsx` installed, for `window.__socketReads` to say what is waiting. */
let appReader: LanedSocketReader | null = null

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
export function createAppSocketReader(log?: SocketReaderOptions['log']): LanedSocketReader {
  return (appReader = createSocketReader({
    getClient: getLiveClient,
    currentPubkey: () => validToken()?.pubkey ?? null,
    budget: socketBudget,
    httpBudget: relayBudget,
    otherFrames: otherFramesSince,
    log,
  }))
}

/** One read the reader was asked for: where it waited, and how it was answered. */
export interface SocketReadRecord {
  at: number
  reqs: number
  liveWaitMs: number
  pacerWaitMs: number
  answerMs: number
  /** `socket`, `http: <why>`, or `refused ahead: <why>`. */
  via: string
  /** `ahead` for a read Desk loaded before it was asked for (PEE-5). */
  lane?: QueryLane
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
    /** What waits now, in the pacer and for a slot on the wire, by lane (PEE-5). */
    now: appReader?.waiting(),
  }
}

export function installSocketReadsDiagnostic(): void {
  if (typeof window === 'undefined') return
  ;(window as unknown as Record<string, unknown>).__socketReads = (minutes?: number) =>
    socketReads(typeof minutes === 'number' && minutes > 0 ? minutes : 1)
}
