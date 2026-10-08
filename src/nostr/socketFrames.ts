/**
 * The frames this tab sends on its relay socket that buzz meters (OPT-2).
 *
 * Buzz counts EVENT, REQ and COUNT frames against one budget per pubkey — 50
 * per 5 s — whoever sent them. The socket reader paces its own one-shot REQs,
 * but the live watches subscribe from inside `@estiva-app/platform` and re-send
 * every subscription on reconnect; at a reader cap of 40 the two together ran
 * at 46–48 per window and the relay refused at its window edges. So the socket
 * itself records what it sends, and the reader counts the rest against the
 * same cap.
 *
 * A REQ sent from inside {@link sendingAsRead} is the reader's own, already
 * counted by its pacer; `LiveRelay.subscribe` sends synchronously while the
 * socket is live, so the flag is set exactly while that send happens.
 */
import type { SocketLike } from '@estiva-app/protocol'

/** Buzz's window (`connection.rs` `enforce_ws_admission`): fixed, per pubkey. */
export const WINDOW_MS = 5_000

const METERED = /^\["(REQ|EVENT|COUNT)"/
let readDepth = 0
const others: number[] = []

export function sendingAsRead<T>(send: () => T): T {
  readDepth += 1
  try {
    return send()
  } finally {
    readDepth -= 1
  }
}

/** Metered frames this tab sent since `floor` that the reader did not send. */
export function otherFramesSince(floor: number): number[] {
  while (others.length > 0 && others[0] <= floor) others.shift()
  return others
}

export function noteFrame(data: unknown, at: number): void {
  if (readDepth > 0 || typeof data !== 'string' || !METERED.test(data)) return
  others.push(at)
  // Nothing older than a window is ever asked about.
  while (others.length > 0 && others[0] <= at - WINDOW_MS) others.shift()
}

/** The `socketFactory` for the tab's live client. */
export function meteredSocket(url: string): SocketLike {
  const socket = new WebSocket(url)
  const send = socket.send.bind(socket)
  socket.send = (data) => {
    noteFrame(data, Date.now())
    send(data)
  }
  return socket as unknown as SocketLike
}
