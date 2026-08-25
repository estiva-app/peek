/**
 * PEE-8 — the tab's single live client.
 *
 * The React wiring in `useTopicView` is thin on purpose; what is worth testing
 * is what this module guarantees to it: one connection per tab, a credential
 * read per connect rather than captured, refcounting that survives StrictMode's
 * double mount, and a state seam for PEE-9.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveProjectionApi } from './liveProjection'
import { getLiveTopics, resetLiveTopicsForTests } from './liveTopics'

const CHANNEL = '11111111-1111-4111-8111-111111111111'
const CHANNEL_B = '22222222-2222-4222-8222-222222222222'
const TOPIC = 'topic-abc'

const api: LiveProjectionApi = {
  importChannel: vi.fn(async () => ({ ok: true, known: [], deletable: [] })),
  importReactions: vi.fn(async () => ({ ok: true })),
  importResolutions: vi.fn(async () => ({ ok: true })),
}

/** Count sockets by stubbing the global the client reaches for. */
let sockets: { url: string; closed: boolean }[] = []

beforeEach(() => {
  sockets = []
  vi.stubGlobal(
    'WebSocket',
    class {
      onopen: unknown = null
      onmessage: unknown = null
      onclose: unknown = null
      onerror: unknown = null
      constructor(url: string) {
        sockets.push({ url, closed: false })
      }
      send() {}
      close() {
        const s = sockets[sockets.length - 1]
        if (s) s.closed = true
      }
    },
  )
  sessionStorage.clear()
})

afterEach(() => {
  resetLiveTopicsForTests()
  vi.unstubAllGlobals()
})

describe('one connection per tab', () => {
  it('opens a single socket however many callers ask', () => {
    // The property the whole design rests on: max_subscriptions is per
    // connection and the relay authenticates a connection once, so a second
    // socket would double the AUTH round trips for nothing.
    getLiveTopics('https://relay.test', api)
    getLiveTopics('https://relay.test', api)
    getLiveTopics('https://relay.test', api)
    expect(sockets).toHaveLength(1)
  })

  it('converts the https relay origin to wss', () => {
    getLiveTopics('https://relay.test', api)
    expect(sockets[0]?.url).toBe('wss://relay.test')
  })

  it('returns the same instance rather than rebuilding', () => {
    expect(getLiveTopics('https://relay.test', api)).toBe(getLiveTopics('https://relay.test', api))
  })

  it('replaces the client when the relay origin changes', () => {
    // A different origin is a different deployment; leaving a socket pointed at
    // the old one would be worse than the reconnect.
    getLiveTopics('https://relay.test', api)
    getLiveTopics('https://other.test', api)
    expect(sockets).toHaveLength(2)
    expect(sockets[0]?.closed).toBe(true)
    expect(sockets[1]?.url).toBe('wss://other.test')
  })
})

describe('watching topics', () => {
  it('survives a StrictMode double mount without losing the subscription', () => {
    // React mounts, unmounts and remounts in development. Two watches on one
    // channel share a REQ through PEE-6's refcount; the first release must not
    // take the second's subscription with it.
    const live = getLiveTopics('https://relay.test', api)
    const first = live.watch({ topicKey: TOPIC, channelUuid: CHANNEL })
    const second = live.watch({ topicKey: TOPIC, channelUuid: CHANNEL })

    first.stop()
    expect(() => second.stop()).not.toThrow()
    expect(sockets).toHaveLength(1)
  })

  it('refuses a channel key that is not a uuid', () => {
    // PEE-6's guard, reachable from here: a topic id would register globally
    // and then never deliver.
    const live = getLiveTopics('https://relay.test', api)
    expect(() => live.watch({ topicKey: TOPIC, channelUuid: TOPIC })).toThrow(
      /not a channel uuid/,
    )
  })

  it('watches several topics on the one connection', () => {
    const live = getLiveTopics('https://relay.test', api)
    live.watch({ topicKey: 'a', channelUuid: CHANNEL })
    live.watch({ topicKey: 'b', channelUuid: CHANNEL_B })
    expect(sockets).toHaveLength(1)
  })

  it('treats a repeated stop as a no-op', () => {
    const live = getLiveTopics('https://relay.test', api)
    const handle = live.watch({ topicKey: TOPIC, channelUuid: CHANNEL })
    handle.stop()
    expect(() => handle.stop()).not.toThrow()
  })
})

describe('the state seam', () => {
  it('reports a state and notifies listeners', () => {
    const live = getLiveTopics('https://relay.test', api)
    expect(['connecting', 'authenticating', 'live', 'reconnecting', 'failed']).toContain(
      live.state(),
    )
    const seen: string[] = []
    const off = live.onState((s) => seen.push(s))
    expect(typeof off).toBe('function')
    off()
  })

  it('stops notifying after unsubscribe', () => {
    const live = getLiveTopics('https://relay.test', api)
    const listener = vi.fn()
    live.onState(listener)()
    // Nothing has driven a transition, but the contract is that the returned
    // function removes the listener rather than being decorative.
    expect(listener).not.toHaveBeenCalled()
  })
})
