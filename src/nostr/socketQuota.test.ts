import { afterEach, describe, expect, it, vi } from 'vitest'
import * as frames from './socketFrames'
import { createFrameShaper, otherFramesSince, resetSocketFrames, SHAPED_WINDOW_MS } from './socketFrames'

/*
  THE-15: the relay's quota is the person's, and their other apps spend it unseen. A quota refusal is the only sign,
  so it counts the relay's window as full. Reached through the module so that, on code without it, this fails on the
  assertion rather than on a missing import.
*/
const noteQuotaRefused = (retryMs: number) => (frames as { noteQuotaRefused?: (ms: number) => void }).noteQuotaRefused?.(retryMs)

afterEach(() => {
  vi.useRealTimers()
  resetSocketFrames()
})

describe('after a quota refusal', () => {
  it('frames wait out the relay’s pause and then go as its window frees, not all at once', async () => {
    vi.useFakeTimers()
    resetSocketFrames()
    const out: string[] = []
    const s = createFrameShaper((data) => out.push(String(data)))
    // Another app of the person's filled the relay's window: it says "retry in 1s".
    noteQuotaRefused(1_000)
    for (let i = 0; i < 10; i++) s.send(`["REQ","peek-${i}",{}]`)
    expect(out).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(900)
    expect(out).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(400)
    expect(out.length).toBeGreaterThan(0)
    expect(out.length).toBeLessThanOrEqual(3)
    await vi.advanceTimersByTimeAsync(SHAPED_WINDOW_MS)
    expect(out).toHaveLength(10)
  })

  it('the refusals of one burst count the window full once, not once each', () => {
    vi.useFakeTimers()
    resetSocketFrames()
    noteQuotaRefused(1_000)
    const full = otherFramesSince(Date.now() - SHAPED_WINDOW_MS).length
    expect(full).toBeGreaterThan(0)
    noteQuotaRefused(1_000)
    expect(otherFramesSince(Date.now() - SHAPED_WINDOW_MS)).toHaveLength(full)
  })
})
