/**
 * The frames this tab sends on its relay socket that buzz meters (OPT-2).
 *
 * Buzz counts EVENT, REQ and COUNT frames against one budget per pubkey — 50
 * per 5 s, in fixed windows — whoever sent them. The socket reader paces its
 * own one-shot REQs, but the live watches subscribe from inside
 * `@estiva-app/platform` whenever a topic opens and re-send every subscription
 * on reconnect. So the socket does two things here:
 *
 * - It records what it sends, and the reader counts the rest against the same
 *   cap ({@link otherFramesSince}). At a read cap of 40, uncounted, the two ran
 *   at 46–48 per window and the relay refused at its window edges.
 * - It never sends more than {@link FRAMES_PER_WINDOW} metered frames in any
 *   {@link WINDOW_MS}: past that, frames wait in order until the oldest leaves
 *   the window. The reader's count only steers its own grants; the watches
 *   still arrive unasked — 45 reads granted, then a topic's watches on top, was
 *   53 in one window at the start of a `--hammer` and two refusals.
 *
 * A REQ sent from inside {@link sendingAsRead} is the reader's own, already
 * counted by its pacer; `LiveRelay.subscribe` sends synchronously while the
 * socket is live, so the flag is set exactly while that send happens.
 */
import type { SocketLike } from '@estiva-app/protocol'

/** Buzz's window (`connection.rs` `enforce_ws_admission`): fixed, per pubkey. */
export const WINDOW_MS = 5_000
/**
 * Of buzz's 50, over a window a second longer than buzz's. Buzz admits frames
 * one at a time in the connection's read loop, a rate-limiter round trip each,
 * so a burst is admitted over the next second or so and its tail lands in the
 * next fixed window: 46 sent in 5 s were refused that way (v5 `--hammer`).
 * Two above the reader's cap, for watches arriving unasked; the other 8 are
 * for Ship and Leaf on the same pubkey (`REQS_PER_WINDOW`). Every Peek load on the device shares the 42 (cbad5360).
 */
export const FRAMES_PER_WINDOW = 42
export const SHAPED_WINDOW_MS = WINDOW_MS + 1_000
/**
 * And at most this many in any second, so no burst builds that lag in the first place. A catch-up's NEG-OPEN
 * (NIP-77, THE-6) counts in the window, which is the relay's quota, but not here: a reopen sends one per question the
 * copy holds as the socket comes up, where a REQ carried up to ten, and counted here they held the Desk's next reads
 * for the rest of that second, ~0.5 s (0efe7c39). What bounds a burst of them is the reader: every NEG-OPEN is sent
 * from `socketRead`'s reconcile, inside one of its MAX_REQS_IN_FLIGHT slots, so at most four are open at once. A
 * caller that reconciles outside the reader must count its NEG-OPENs here again.
 */
export const FRAMES_PER_SECOND = 12
/**
 * Of each cap, what other frames leave for a file's first page while it is
 * being read (PEE-7). Opening a topic asks ~19 frames at once — the Folders,
 * their dots, the file's members and mentions — and its first page, asked
 * seventh, went out thirteenth, after the second's twelve: 1 s on the wire's
 * queue for a read the relay answers in 0.3 s. The page is two or three REQs.
 */
export const FIRST_RESERVE = 3
/** How long after a first-page read answers its room is still kept: the next read of that page asks within it. */
export const FIRST_GRACE_MS = 300
/**
 * How long after it is asked a first page unanswered still has its room kept: one the relay is slow to end (no
 * EOSE until the read's 10 s timeout) must not hold every other frame to nine a second all that while.
 */
export const FIRST_HOLD_MS = 3_000
/** While a first page is still being read, how often a frame held back for it looks again. */
const FIRST_RECHECK_MS = 100

// A NEG-OPEN (NIP-77, THE-6) is metered as one REQ; the NEG-MSG rounds inside it are not.
const METERED = /^\["(REQ|EVENT|COUNT|NEG-OPEN)"/
let readDepth = 0
let firstDepth = 0
/** When each first-page read not answered yet was asked, and until when the room is kept after the last one answered. */
const firstAsked: number[] = []
let firstUntil = 0
/** Every metered frame sent, across reconnects: the budget is the pubkey's, not the connection's. */
const sent: number[] = []
/** The ones the per-second cap counts: a catch-up's NEG-OPEN is in the window, not in the second (0efe7c39). */
const sentForSecond: number[] = []
/** The ones the reader's pacer did not grant: not the reader's, or a first page's, which skips it. */
const others: number[] = []

/**
 * Every Peek load on this device writes the metered frames it sent in the last window here, by load, and counts the
 * other loads' (cbad5360). The relay counts the pubkey, but `sent` is this page's memory: a reload, or a second tab,
 * started from nothing while the last load's catch-up was still in the relay's window, and one Peek sent 51–54 in
 * 5 s (smoke run, 25 Nov). Timestamps only, gone a window later.
 */
const SHARED_KEY = 'estiva-peek:socket-frames'
let load = Math.random().toString(36).slice(2)

function sharedStore(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readShared(store: Storage): Record<string, number[]> {
  try {
    const parsed: unknown = JSON.parse(store.getItem(SHARED_KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number[]>) : {}
  } catch {
    return {}
  }
}

/**
 * Whether a stored time is in the window that starts at `floor` and ends now. One later than now is the clock having
 * moved back since it was written: counted, it would hold every frame until the clock caught up, reloads included.
 */
const inSpan = (at: unknown, floor: number): at is number =>
  typeof at === 'number' && at > floor && at <= floor + SHAPED_WINDOW_MS

/** The metered frames the other Peek loads on this device sent after `floor`, oldest first. */
function elsewhere(floor: number): number[] {
  const store = sharedStore()
  if (!store) return []
  const out: number[] = []
  for (const [id, times] of Object.entries(readShared(store))) {
    if (id === load || !Array.isArray(times)) continue
    for (const at of times) if (inSpan(at, floor)) out.push(at)
  }
  return out.sort((a, b) => a - b)
}

/**
 * Writes this load's frames in the window, and drops the loads with none left in it. Two tabs writing at once can
 * lose one's newest entry until it writes again: an undercount of a frame or two, inside the 8 the cap leaves.
 */
function writeShared(floor: number) {
  const store = sharedStore()
  if (!store) return
  const all = readShared(store)
  for (const [id, times] of Object.entries(all)) {
    if (!Array.isArray(times) || !times.some((at) => inSpan(at, floor))) delete all[id]
  }
  all[load] = sent.slice()
  try {
    store.setItem(SHARED_KEY, JSON.stringify(all))
  } catch {
    // A full or refused store only loses the other loads' view of this one.
  }
}

/** This load's frames merged with the other loads', oldest first: what the relay's window holds of this device. */
function inWindow(floor: number, mine: number[]): number[] {
  const theirs = elsewhere(floor)
  return theirs.length === 0 ? mine : [...mine, ...theirs].sort((a, b) => a - b)
}

export function sendingAsRead<T>(send: () => T): T {
  readDepth += 1
  try {
    return send()
  } finally {
    readDepth -= 1
  }
}

/** Sends a first page's REQ (PEE-7): ahead of every frame waiting, into the room the others leave it. */
export function sendingFirst<T>(send: () => T): T {
  firstDepth += 1
  try {
    return send()
  } finally {
    firstDepth -= 1
  }
}

/** A first-page read begins: other frames leave it room until it answers. Call what it returns when it has. */
export function readingFirst(now: () => number = Date.now): () => void {
  const asked = now()
  firstAsked.push(asked)
  let done = false
  return () => {
    if (done) return
    done = true
    firstAsked.splice(firstAsked.indexOf(asked), 1)
    firstUntil = Math.max(firstUntil, Math.min(now(), asked + FIRST_HOLD_MS) + FIRST_GRACE_MS)
  }
}

/** Whether a first page is being read at `at`, asked less than {@link FIRST_HOLD_MS} ago. */
const readingFirstAt = (at: number) => firstAsked.some((asked) => at - asked < FIRST_HOLD_MS)

function trim(log: number[], floor: number) {
  while (log.length > 0 && log[0] <= floor) log.shift()
}

/** How long until a frame fits under each cap less `reserve`. */
function waitUnder(at: number, reserve: number): number {
  const perWindow = FRAMES_PER_WINDOW - reserve
  const perSecond = FRAMES_PER_SECOND - reserve
  let wait = 0
  const counted = inWindow(at - SHAPED_WINDOW_MS, sent)
  if (counted.length >= perWindow) wait = counted[counted.length - perWindow] + SHAPED_WINDOW_MS - at
  trim(sentForSecond, at - 1_000)
  if (sentForSecond.length >= perSecond) wait = Math.max(wait, sentForSecond[sentForSecond.length - perSecond] + 1_000 - at)
  return Math.max(0, wait)
}

/**
 * How long a first page's REQ asked now would wait for room (PEE-7): it skips the reader's pacer, so this is what
 * decides it goes over HTTP instead, as a click's read that waited too long does.
 */
export function firstFrameWaitMs(now: () => number = Date.now): number {
  const at = now()
  trim(sent, at - SHAPED_WINDOW_MS)
  return waitUnder(at, 0)
}

/** Metered frames since `floor` that the reader did not send: this load's, and every other Peek load's on the device. */
export function otherFramesSince(floor: number): number[] {
  trim(others, floor)
  return inWindow(floor, others)
}

interface Frame {
  data: string
  metered: boolean
  read: boolean
  first: boolean
}

/** A NIP-77 frame's reconciliation id: its second element. */
function negId(data: string): string | undefined {
  const start = data.indexOf('","') + 3
  const end = data.indexOf('"', start)
  return start > 2 && end > start ? data.slice(start, end) : undefined
}

function classify(data: unknown): Frame | null {
  if (typeof data !== 'string') return null
  const metered = METERED.test(data)
  return { data, metered, read: readDepth > 0, first: metered && firstDepth > 0 }
}

export interface FrameShaper {
  /** Sends now, or queues behind whatever already waits. */
  send(data: unknown): void
  /** Frames waiting for room. */
  waiting(): number
  /** The socket is gone: drop the queue (the relay re-sends its subscriptions on reconnect). */
  drop(): void
}

/** The metering and the cap, apart from the socket, so a test can drive the clock. */
export function createFrameShaper(
  transmit: (data: string) => void,
  now: () => number = Date.now,
  setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle: unknown) => void = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
): FrameShaper {
  const queue: Frame[] = []
  let timer: unknown = null

  /** 0 when `frame` may go now, or how long until it may. */
  function waitFor(frame: Frame): number {
    if (!frame.metered) return 0
    const at = now()
    trim(sent, at - SHAPED_WINDOW_MS)
    const wait = waitUnder(at, 0)
    const reading = readingFirstAt(at)
    if (frame.first || (!reading && at >= firstUntil)) return wait
    // Held back only by the room a first page is kept: until it is not, or a look again while it is still read.
    const held = waitUnder(at, FIRST_RESERVE)
    return held <= wait ? wait : Math.max(wait, Math.min(held, reading ? FIRST_RECHECK_MS : firstUntil - at))
  }
  const hasRoom = (frame: Frame) => waitFor(frame) === 0

  function put(frame: Frame) {
    if (frame.metered) {
      const at = now()
      trim(sent, at - SHAPED_WINDOW_MS)
      sent.push(at)
      writeShared(at - SHAPED_WINDOW_MS)
      if (!frame.data.startsWith('["NEG-OPEN"')) sentForSecond.push(at)
      if (!frame.read || frame.first) others.push(at)
    }
    transmit(frame.data)
  }

  function flush() {
    timer = null
    while (queue.length > 0 && hasRoom(queue[0])) put(queue.shift()!)
    if (queue.length > 0) timer = setTimer(flush, waitFor(queue[0]) + 1)
  }

  return {
    send(data) {
      const frame = classify(data)
      if (!frame) return transmit(data as string)
      // In order: a CLOSE must never overtake the REQ it closes. AUTH may: the
      // REQs queued on a reconnect would otherwise reach the relay before it.
      // So may a first page's REQ, which opens a subscription of its own.
      if (frame.data.startsWith('["AUTH"') || ((queue.length === 0 || frame.first) && hasRoom(frame))) return put(frame)
      // A catch-up's round (NIP-77, THE-6) answers the relay, so its NEG-OPEN is already sent: it is not metered and
      // must not wait behind REQs held for room. Its NEG-CLOSE may go too, unless its NEG-OPEN is still waiting here.
      if (frame.data.startsWith('["NEG-MSG"')) return put(frame)
      if (frame.data.startsWith('["NEG-CLOSE"')) {
        const id = negId(frame.data)
        if (!queue.some((waiting) => waiting.data.startsWith('["NEG-OPEN"') && negId(waiting.data) === id)) return put(frame)
      }
      if (frame.first) {
        let at = 0
        while (at < queue.length && queue[at].first) at += 1
        queue.splice(at, 0, frame)
        if (timer !== null) clearTimer(timer)
        flush()
        return
      }
      queue.push(frame)
      if (timer === null) flush()
    },
    waiting: () => queue.length,
    drop() {
      queue.length = 0
      if (timer !== null) clearTimer(timer)
      timer = null
    },
  }
}

/** Test seam: forget what was sent, and start as a new load (`elsewhere` still holds what earlier ones wrote). */
export function resetSocketFrames(): void {
  load = Math.random().toString(36).slice(2)
  sent.length = 0
  sentForSecond.length = 0
  others.length = 0
  firstAsked.length = 0
  firstUntil = 0
}

/** The `socketFactory` for the tab's live client. */
export function meteredSocket(url: string): SocketLike {
  const socket = new WebSocket(url)
  const raw = socket.send.bind(socket)
  const shaper = createFrameShaper((data) => {
    // A frame let out after the socket closed is lost with it; the relay
    // re-sends every subscription on the next connection.
    if (socket.readyState !== WebSocket.OPEN) return shaper.drop()
    raw(data)
  })
  socket.send = (data) => shaper.send(data)
  return socket as unknown as SocketLike
}
