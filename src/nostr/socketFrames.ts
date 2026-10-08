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

const METERED = /^\["(REQ|EVENT|COUNT)"/
let readDepth = 0
/** Every metered frame sent, across reconnects: the budget is the pubkey's, not the connection's. */
const sent: number[] = []
/** The ones the reader did not send. */
const others: number[] = []

export function sendingAsRead<T>(send: () => T): T {
  readDepth += 1
  try {
    return send()
  } finally {
    readDepth -= 1
  }
}

function trim(log: number[], floor: number) {
  while (log.length > 0 && log[0] <= floor) log.shift()
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
}

function classify(data: unknown): Frame | null {
  if (typeof data !== 'string') return null
  return { data, metered: METERED.test(data), read: readDepth > 0 }
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
    let wait = 0
    if (sent.length >= FRAMES_PER_WINDOW) wait = sent[sent.length - FRAMES_PER_WINDOW] + SHAPED_WINDOW_MS - at
    if (sent.length >= FRAMES_PER_SECOND) wait = Math.max(wait, sent[sent.length - FRAMES_PER_SECOND] + 1_000 - at)
    return Math.max(0, wait)
  }
  const hasRoom = (frame: Frame) => waitFor(frame) === 0

  function put(frame: Frame) {
    if (frame.metered) {
      const at = now()
      sent.push(at)
      if (!frame.read) others.push(at)
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
      if (frame.data.startsWith('["AUTH"') || (queue.length === 0 && hasRoom(frame))) return put(frame)
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
