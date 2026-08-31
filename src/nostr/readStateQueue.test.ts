import { describe, it, expect, vi } from 'vitest'
import { createReadStateQueue } from './readStateQueue'
import type { ReadStateBlob } from './readState'

const UUID = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
const OTHER_UUID = 'c8d2f1b5-3a4e-4b97-8d26-9e1f7a3b5c02'
const EVENT = 'a'.repeat(64)

/** A controllable clock, so nothing here waits on a real timer. */
function fakeTimers() {
  let next = 1
  const pending = new Map<number, () => void>()
  return {
    setTimer: (fn: () => void) => {
      const handle = next++
      pending.set(handle, fn)
      return handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => void pending.delete(handle as unknown as number),
    /** Fire every scheduled callback. */
    run: () => {
      const fns = [...pending.values()]
      pending.clear()
      fns.forEach((fn) => fn())
    },
    count: () => pending.size,
  }
}

/** The queue's publish callback, typed so `mock.calls[n][0]` is the blob. */
type Publish = (contexts: Record<string, number>) => Promise<boolean>

function blob(contexts: Record<string, number>): ReadStateBlob {
  return { v: 1, client_id: 'peek-test', contexts }
}

describe('createReadStateQueue', () => {
  it('batches a burst of markers into one publish', async () => {
    const timers = fakeTimers()
    const publish = vi.fn<Publish>(async () => true)
    const queue = createReadStateQueue({
      hydrate: async () => blob({}),
      publish,
      ...timers,
    })

    // Opening five topics must not publish five events.
    queue.record(UUID, 1000)
    queue.record(OTHER_UUID, 1001)
    queue.record(`thread:${EVENT}`, 1002)
    expect(publish).not.toHaveBeenCalled()

    timers.run()
    await queue.flush()

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toEqual({
      [UUID]: 1000,
      [OTHER_UUID]: 1001,
      [`thread:${EVENT}`]: 1002,
    })
  })

  /**
   * The trap the ticket names: the blob is a replaceable snapshot, not a delta.
   * Publishing without hydrating replaces the coordinate with only what this
   * session saw, and the loss is invisible until this is the only slot left.
   */
  it('publishes the whole blob, including contexts it never recorded', async () => {
    const publish = vi.fn<Publish>(async () => true)
    const timers = fakeTimers()
    const queue = createReadStateQueue({
      hydrate: async () => blob({ [OTHER_UUID]: 500 }),
      publish,
      ...timers,
    })

    queue.record(UUID, 1000)
    await queue.flush()

    expect(publish.mock.calls[0][0]).toEqual({ [OTHER_UUID]: 500, [UUID]: 1000 })
  })

  it('does not lower a hydrated marker with an older one', async () => {
    const publish = vi.fn<Publish>(async () => true)
    const queue = createReadStateQueue({
      hydrate: async () => blob({ [UUID]: 9000 }),
      publish,
      ...fakeTimers(),
    })

    queue.record(UUID, 1000)
    await queue.flush()

    // Nothing to send: the recorded marker is older than what is already there.
    expect(publish).not.toHaveBeenCalled()
  })

  it('ignores a marker it would not publish, and schedules nothing for it', async () => {
    const publish = vi.fn<Publish>(async () => true)
    const timers = fakeTimers()
    const queue = createReadStateQueue({ hydrate: async () => blob({}), publish, ...timers })

    queue.record('3', 1000) // a Peek topic id
    queue.record(`h:${UUID}`, 1000) // the prefixed spelling
    expect(timers.count()).toBe(0)

    await queue.flush()
    expect(publish).not.toHaveBeenCalled()
  })

  it('does nothing when there is nothing pending', async () => {
    const publish = vi.fn<Publish>(async () => true)
    const queue = createReadStateQueue({ hydrate: async () => blob({}), publish, ...fakeTimers() })
    await queue.flush()
    expect(publish).not.toHaveBeenCalled()
  })

  /**
   * "Could not find out" is not "empty", and the difference is destructive.
   * Publishing with an unknown relay state replaces the coordinate with only
   * what this session recorded, dropping every context written before it — and
   * because the cross-slot merge is grow-only, that loss stays invisible until
   * this is the last slot standing.
   */
  it('refuses to publish while hydration has not succeeded, and retries', async () => {
    const publish = vi.fn<Publish>(async () => true)
    const hydrate = vi.fn<() => Promise<ReadStateBlob | undefined>>()
    hydrate.mockResolvedValueOnce(undefined).mockResolvedValueOnce(blob({ [OTHER_UUID]: 500 }))
    const queue = createReadStateQueue({ hydrate, publish, ...fakeTimers() })

    queue.record(UUID, 1000)
    await queue.flush()

    expect(hydrate).toHaveBeenCalledTimes(1)
    expect(publish).not.toHaveBeenCalled()

    // The marker was kept, so the next flush tries again — and this time it can
    // send the whole blob, the relay's contexts included.
    await queue.flush()
    expect(hydrate).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toEqual({ [OTHER_UUID]: 500, [UUID]: 1000 })
  })

  it('keeps markers that arrive while a publish is in flight', async () => {
    const publish = vi.fn<Publish>(async () => {
      // Recorded from inside the publish, which is the only way to land strictly
      // between "this blob was snapshotted" and "the publish resolved".
      if (publish.mock.calls.length === 1) queue.record(OTHER_UUID, 2000)
      return true
    })
    const queue = createReadStateQueue({ hydrate: async () => blob({}), publish, ...fakeTimers() })

    queue.record(UUID, 1000)
    await queue.flush()
    await queue.flush()

    expect(publish).toHaveBeenCalledTimes(2)
    // The first blob did not carry it; the second does, along with everything else.
    expect(publish.mock.calls[0][0]).toEqual({ [UUID]: 1000 })
    expect(publish.mock.calls[1][0]).toEqual({ [UUID]: 1000, [OTHER_UUID]: 2000 })
  })

  it('retries the markers a failed publish was carrying', async () => {
    const publish = vi.fn<Publish>()
    publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const queue = createReadStateQueue({ hydrate: async () => blob({}), publish, ...fakeTimers() })

    queue.record(UUID, 1000)
    await queue.flush()
    expect(publish).toHaveBeenCalledTimes(1)

    // Nothing new recorded — the retry is driven by the markers put back.
    await queue.flush()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]).toEqual({ [UUID]: 1000 })
  })

  it('hydrates once, not on every flush', async () => {
    const hydrate = vi.fn(async () => blob({}))
    const queue = createReadStateQueue({ hydrate, publish: async () => true, ...fakeTimers() })

    queue.record(UUID, 1000)
    await queue.flush()
    queue.record(OTHER_UUID, 2000)
    await queue.flush()

    expect(hydrate).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the pending timer without publishing', async () => {
    const publish = vi.fn<Publish>(async () => true)
    const timers = fakeTimers()
    const queue = createReadStateQueue({ hydrate: async () => blob({}), publish, ...timers })

    queue.record(UUID, 1000)
    queue.cancel()
    timers.run()

    expect(publish).not.toHaveBeenCalled()
    // The marker is still known — cancel drops the timer, not the state.
    expect(queue.snapshot()).toEqual({ [UUID]: 1000 })
  })
})
