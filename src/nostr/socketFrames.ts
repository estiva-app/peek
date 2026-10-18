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
 * for Ship and other tabs on the same pubkey (`REQS_PER_WINDOW`).
 */
export const FRAMES_PER_WINDOW = 42
export const SHAPED_WINDOW_MS = WINDOW_MS + 1_000
/** And at most this many in any second, so no burst builds that lag in the first place. */
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

const METERED = /^\["(REQ|EVENT|COUNT)"/
let readDepth = 0
let firstDepth = 0
/** When each first-page read not answered yet was asked, and until when the room is kept after the last one answered. */
const firstAsked: number[] = []
let firstUntil = 0
/** Every metered frame sent, across reconnects: the budget is the pubkey's, not the connection's. */
const sent: number[] = []
/** The ones the reader's pacer did not grant: not the reader's, or a first page's, which skips it. */
const others: number[] = []

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
  if (sent.length >= perWindow) wait = sent[sent.length - perWindow] + SHAPED_WINDOW_MS - at
  if (sent.length >= perSecond) wait = Math.max(wait, sent[sent.length - perSecond] + 1_000 - at)
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

/** Metered frames this tab sent since `floor` that the reader did not send. */
export function otherFramesSince(floor: number): number[] {
  trim(others, floor)
  return others
}

interface Frame {
  data: string
  metered: boolean
  read: boolean
  first: boolean
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
      sent.push(at)
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

/** Test seam: forget what was sent. */
export function resetSocketFrames(): void {
  sent.length = 0
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
