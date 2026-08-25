/**
 * PEE-7 — routing live events into the projection.
 *
 * The projection itself is covered by `convex/nostr/projection.test.ts`; none
 * of it is re-tested here. What is tested is the routing: which action gets
 * which kind, in what order, how a burst is batched, and what happens when a
 * call fails.
 *
 * The kind:1111 case has its own test because omitting it is the failure that
 * would have shipped: Ship's comments moved to NIP-22 with REW-10 and land in
 * the same channel, so routing only kind:9 makes them vanish from live delivery
 * with no error at all.
 */
import { describe, expect, it, vi } from 'vitest'
import { KIND, type SignedEvent } from '../../convex/nostr/events'
import type { ChannelSubscriptions } from './channelSubscriptions'
import { createLiveProjection, type LiveProjectionApi } from './liveProjection'

const CHANNEL = '11111111-1111-4111-8111-111111111111'
const TOPIC = 'topic-abc'

const event = (id: string, kind: number, pubkey = 'a'.repeat(64)) =>
  ({ id, kind, pubkey, created_at: 1_756_000_000, tags: [], content: '', sig: 'f' }) as SignedEvent

/** A subscription manager stub that hands back the delivery callback. */
function stubSubscriptions() {
  let deliver: ((e: SignedEvent) => void) | undefined
  let released = 0
  const subscriptions = {
    subscribe(_channelUuid: string, onEvent: (e: SignedEvent) => void) {
      deliver = onEvent
      return { release: () => { released += 1 } }
    },
  } satisfies Pick<ChannelSubscriptions, 'subscribe'>
  return {
    subscriptions,
    emit: (...events: SignedEvent[]) => events.forEach((e) => deliver?.(e)),
    releaseCount: () => released,
  }
}

function stubApi(overrides: Partial<LiveProjectionApi> = {}) {
  const calls: string[] = []
  const api: LiveProjectionApi = {
    importChannel: vi.fn(async () => {
      calls.push('importChannel')
      return { ok: true, known: ['known-1'], deletable: ['deletable-1'] }
    }),
    importReactions: vi.fn(async () => {
      calls.push('importReactions')
      return { ok: true }
    }),
    importResolutions: vi.fn(async () => {
      calls.push('importResolutions')
      return { ok: true }
    }),
    ...overrides,
  }
  return { api, calls }
}

/** A harness whose timer is fired by hand, so no test waits 250ms. */
function harness(apiOverrides: Partial<LiveProjectionApi> = {}) {
  const subs = stubSubscriptions()
  const { api, calls } = stubApi(apiOverrides)
  const timers: (() => void)[] = []
  const logs: string[] = []
  const projection = createLiveProjection({
    subscriptions: subs.subscriptions,
    api,
    setTimer: (fn) => {
      timers.push(fn)
      return timers.length - 1
    },
    clearTimer: () => {},
    log: (message) => logs.push(message),
  })
  const handle = projection.watch({ topicKey: TOPIC, channelUuid: CHANNEL })
  return {
    projection,
    handle,
    api,
    calls,
    logs,
    emit: subs.emit,
    releaseCount: subs.releaseCount,
    /** Fire the batch window and wait for the flush to settle. */
    async tick() {
      timers.shift()?.()
      await projection.flushNow()
    },
    pendingTimers: () => timers.length,
  }
}

describe('routing by kind', () => {
  it('sends messages to importChannel', async () => {
    const h = harness()
    h.emit(event('m1', KIND.STREAM_MESSAGE))
    await h.tick()

    expect(h.api.importChannel).toHaveBeenCalledWith({
      topicKey: TOPIC,
      events: [expect.objectContaining({ id: 'm1' })],
      profiles: [],
    })
  })

  it('treats kind:1111 as a message, not an unknown kind', async () => {
    // REW-10 moved Ship's comments to NIP-22, and a Ship comment is posted into
    // the project's Folder — which is this topic's channel. Routing only kind:9
    // would make them vanish from live delivery with no error. The first live
    // events seen on this socket in PEE-6 were 1111, not 9.
    const h = harness()
    h.emit(event('c1', KIND.COMMENT))
    await h.tick()

    expect(h.api.importChannel).toHaveBeenCalledWith(
      expect.objectContaining({ events: [expect.objectContaining({ id: 'c1', kind: 1111 })] }),
    )
    expect(h.logs).not.toContain('ignoring an unprojected kind')
  })

  it('sends reactions and deletions to importReactions together', async () => {
    // One call, not two: a kind:5 looks identical whichever it retracts, and
    // the action takes both lists.
    const h = harness()
    h.emit(event('r1', KIND.REACTION), event('d1', KIND.DELETION))
    await h.tick()

    expect(h.api.importReactions).toHaveBeenCalledOnce()
    expect(h.api.importReactions).toHaveBeenCalledWith(
      expect.objectContaining({
        reactions: [expect.objectContaining({ id: 'r1' })],
        deletions: [expect.objectContaining({ id: 'd1' })],
      }),
    )
  })

  it('sends assertions to importResolutions', async () => {
    const h = harness()
    h.emit(event('a1', KIND.ASSERTION))
    await h.tick()
    expect(h.api.importResolutions).toHaveBeenCalledWith({
      topicKey: TOPIC,
      assertions: [expect.objectContaining({ id: 'a1' })],
    })
  })

  it('ignores a kind the projection has no home for', async () => {
    // A kindless subscription delivers everything in the channel, so this is
    // expected rather than exceptional — and it must not reach importChannel as
    // if it were a message.
    const h = harness()
    h.emit(event('x1', 30078))
    await h.tick()

    expect(h.api.importChannel).not.toHaveBeenCalled()
    expect(h.logs).toContain('ignoring an unprojected kind')
  })
})

describe('the order within a flush', () => {
  it('imports messages, then reactions, then assertions', async () => {
    // A reaction or an assertion whose target arrived in the same batch has
    // nothing to attach to until the messages are in.
    const h = harness()
    h.emit(
      event('a1', KIND.ASSERTION),
      event('r1', KIND.REACTION),
      event('m1', KIND.STREAM_MESSAGE),
    )
    await h.tick()

    expect(h.calls).toEqual(['importChannel', 'importReactions', 'importResolutions'])
  })

  it('threads known and deletable from importChannel into importReactions', async () => {
    // These are the ids Peek already holds, computed after the import — never
    // the events just delivered. Once the relay has a kind:5 it stops returning
    // the target, so the delivered ids could never find their own deletion.
    const h = harness()
    h.emit(event('r1', KIND.REACTION))
    await h.tick()

    expect(h.api.importReactions).toHaveBeenCalledWith(
      expect.objectContaining({ known: ['known-1'], deletable: ['deletable-1'] }),
    )
  })

  it('calls importChannel even when the batch has no messages', async () => {
    // It is the only source of `known` and `deletable`. Skipping it when there
    // is nothing to import would leave a reaction with empty lists and silently
    // fail to attach.
    const h = harness()
    h.emit(event('r1', KIND.REACTION))
    await h.tick()

    expect(h.api.importChannel).toHaveBeenCalledWith({ topicKey: TOPIC, events: [], profiles: [] })
  })

  it('does not call the later actions when importChannel fails', async () => {
    const h = harness({
      importChannel: vi.fn(async () => ({ ok: false, reason: 'not signed in' })),
    })
    h.emit(event('m1', KIND.STREAM_MESSAGE), event('r1', KIND.REACTION))
    await h.tick()

    expect(h.api.importReactions).not.toHaveBeenCalled()
    expect(h.logs).toContain('importChannel failed')
  })

  it('keeps working when an action throws', async () => {
    // A relay or Convex blip must leave the app on the rows it already has.
    const h = harness({
      importChannel: vi.fn(async () => {
        throw new Error('network')
      }),
    })
    h.emit(event('m1', KIND.STREAM_MESSAGE))
    await expect(h.tick()).resolves.toBeUndefined()
    expect(h.logs).toContain('projecting a live batch failed')
  })
})

describe('batching', () => {
  it('collapses a burst into one call per kind group', async () => {
    // The stated requirement: ten events must be one call per group, not ten.
    const h = harness()
    for (let i = 0; i < 10; i++) h.emit(event(`m${i}`, KIND.STREAM_MESSAGE))
    for (let i = 0; i < 10; i++) h.emit(event(`r${i}`, KIND.REACTION))
    await h.tick()

    expect(h.api.importChannel).toHaveBeenCalledOnce()
    expect(h.api.importReactions).toHaveBeenCalledOnce()
    expect(h.api.importChannel).toHaveBeenCalledWith(
      expect.objectContaining({ events: expect.arrayContaining([]) }),
    )
    const args = vi.mocked(h.api.importChannel).mock.calls[0]?.[0]
    expect(args?.events).toHaveLength(10)
  })

  it('opens one window per burst rather than restarting it on every event', async () => {
    // A trailing debounce would keep resetting on a busy channel and could
    // starve; a fixed window from the first event bounds latency.
    const h = harness()
    h.emit(event('m1', KIND.STREAM_MESSAGE))
    h.emit(event('m2', KIND.STREAM_MESSAGE))
    h.emit(event('m3', KIND.STREAM_MESSAGE))
    expect(h.pendingTimers()).toBe(1)
  })

  it('preserves arrival order and does not sort by created_at', async () => {
    // created_at is in seconds and several events routinely share one, so it is
    // not a total order — and a duplicate timestamp is not a duplicate event.
    const h = harness()
    const a = { ...event('m1', KIND.STREAM_MESSAGE), created_at: 1_756_000_009 }
    const b = { ...event('m2', KIND.STREAM_MESSAGE), created_at: 1_756_000_001 }
    const c = { ...event('m3', KIND.STREAM_MESSAGE), created_at: 1_756_000_001 }
    h.emit(a, b, c)
    await h.tick()

    const args = vi.mocked(h.api.importChannel).mock.calls[0]?.[0]
    expect(args?.events.map((e) => e.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('does not deduplicate a repeated event id', async () => {
    // Live and backfill overlap by design; imports are idempotent by id and the
    // cursor only moves forward. Adding dedup here would be fixing what is not
    // broken.
    const h = harness()
    h.emit(event('m1', KIND.STREAM_MESSAGE), event('m1', KIND.STREAM_MESSAGE))
    await h.tick()

    const args = vi.mocked(h.api.importChannel).mock.calls[0]?.[0]
    expect(args?.events).toHaveLength(2)
  })

  it('starts a fresh window after a flush', async () => {
    const h = harness()
    h.emit(event('m1', KIND.STREAM_MESSAGE))
    await h.tick()
    h.emit(event('m2', KIND.STREAM_MESSAGE))
    await h.tick()

    expect(h.api.importChannel).toHaveBeenCalledTimes(2)
  })

  it('does nothing at all when the window fires with an empty batch', async () => {
    const h = harness()
    await h.tick()
    expect(h.api.importChannel).not.toHaveBeenCalled()
  })
})

describe('the two keys', () => {
  it('subscribes by channel uuid and imports by topicKey', async () => {
    // The pair RFC 0.3 asks not to be confused: the subscription is scoped by
    // the channel, the projection is keyed by the topic, and neither
    // substitutes for the other.
    const subs = stubSubscriptions()
    const subscribe = vi.spyOn(subs.subscriptions, 'subscribe')
    const { api } = stubApi()
    const timers: (() => void)[] = []
    const projection = createLiveProjection({
      subscriptions: subs.subscriptions,
      api,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
    })
    projection.watch({ topicKey: TOPIC, channelUuid: CHANNEL })

    expect(subscribe).toHaveBeenCalledWith(CHANNEL, expect.any(Function))
    subs.emit(event('m1', KIND.STREAM_MESSAGE))
    timers.shift()?.()
    await projection.flushNow()
    expect(api.importChannel).toHaveBeenCalledWith(
      expect.objectContaining({ topicKey: TOPIC }),
    )
  })
})

describe('stopping', () => {
  it('releases the subscription and drops a pending batch', async () => {
    const h = harness()
    h.emit(event('m1', KIND.STREAM_MESSAGE))
    h.handle.stop()
    await h.tick()

    expect(h.releaseCount()).toBe(1)
    expect(h.api.importChannel).not.toHaveBeenCalled()
  })

  it('treats a repeated stop as a no-op', () => {
    const h = harness()
    h.handle.stop()
    h.handle.stop()
    expect(h.releaseCount()).toBe(1)
  })
})
