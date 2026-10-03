import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const markFileRead = vi.fn()
const markContainerRead = vi.fn()
const markThreadRead = vi.fn()
vi.mock('@/api', () => ({
  READ_DWELL_MS: 1500,
  useReadActions: () => ({ markFileRead, markContainerRead, markThreadRead }),
}))

const { useMarkDmRead, useMarkFileRead, useMarkThreadRead } = await import('./useMarkRead')

const FILE = `30851:${'e'.repeat(64)}:issue`
const DM = 'b'.repeat(64)
const ROOT = 'c'.repeat(64)

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  markFileRead.mockClear()
  markContainerRead.mockClear()
  markThreadRead.mockClear()
  setHidden(false)
})
afterEach(() => {
  vi.useRealTimers()
  // Back to jsdom's own getter, so no later test reads the stub.
  delete (document as { hidden?: boolean }).hidden
})

describe('useMarkFileRead (PEE-44)', () => {
  it('marks the file after the dwell, not on open', () => {
    renderHook(() => useMarkFileRead(FILE, 100))
    vi.advanceTimersByTime(1499)
    expect(markFileRead).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(markFileRead).toHaveBeenCalledWith(FILE, 100)
  })

  it('marks again when a message arrives while the file is open', () => {
    const { rerender } = renderHook(({ newest }) => useMarkFileRead(FILE, newest), { initialProps: { newest: 100 } })
    vi.advanceTimersByTime(1500)
    expect(markFileRead).toHaveBeenCalledTimes(1)
    rerender({ newest: 200 })
    vi.advanceTimersByTime(1500)
    expect(markFileRead).toHaveBeenCalledTimes(2)
  })

  it('marks nothing while the tab is hidden, and marks once it is shown', () => {
    setHidden(true)
    renderHook(() => useMarkFileRead(FILE, 100))
    vi.advanceTimersByTime(5000)
    expect(markFileRead).not.toHaveBeenCalled()
    setHidden(false)
    vi.advanceTimersByTime(1500)
    expect(markFileRead).toHaveBeenCalledTimes(1)
  })

  it('marks nothing for a file that did not resolve', () => {
    renderHook(() => useMarkFileRead(undefined, 100))
    vi.advanceTimersByTime(5000)
    expect(markFileRead).not.toHaveBeenCalled()
  })

  it('marks nothing before a message is drawn — the clock is never the mark', () => {
    const { rerender } = renderHook(({ newest }) => useMarkFileRead(FILE, newest), { initialProps: { newest: undefined as number | undefined } })
    vi.advanceTimersByTime(5000)
    expect(markFileRead).not.toHaveBeenCalled()
    rerender({ newest: 100 })
    vi.advanceTimersByTime(1500)
    expect(markFileRead).toHaveBeenCalledWith(FILE, 100)
  })
})

describe('useMarkDmRead (PEE-44)', () => {
  it('marks the DM up to its newest message, and again when one arrives while it is open', () => {
    const { rerender } = renderHook(({ newest }) => useMarkDmRead(DM, newest), { initialProps: { newest: 100 } })
    vi.advanceTimersByTime(1500)
    expect(markContainerRead).toHaveBeenLastCalledWith(DM, 100)
    rerender({ newest: 200 })
    vi.advanceTimersByTime(1500)
    expect(markContainerRead).toHaveBeenLastCalledWith(DM, 200)
    expect(markThreadRead).not.toHaveBeenCalled()
  })

  it('waits while the tab is hidden', () => {
    const { rerender } = renderHook(({ newest }) => useMarkDmRead(DM, newest), { initialProps: { newest: 100 } })
    vi.advanceTimersByTime(1500)
    setHidden(true)
    rerender({ newest: 200 })
    vi.advanceTimersByTime(5000)
    expect(markContainerRead).toHaveBeenCalledTimes(1)
    setHidden(false)
    vi.advanceTimersByTime(1500)
    expect(markContainerRead).toHaveBeenLastCalledWith(DM, 200)
  })

  it('marks nothing for no DM', () => {
    renderHook(() => useMarkDmRead(null, 100))
    vi.advanceTimersByTime(5000)
    expect(markContainerRead).not.toHaveBeenCalled()
  })
})

describe('useMarkThreadRead (PEE-44)', () => {
  it('marks the open thread up to its newest reply, re-armed by a new one, and nothing else', () => {
    const { rerender } = renderHook(({ newest }) => useMarkThreadRead(ROOT, newest), { initialProps: { newest: 300 } })
    vi.advanceTimersByTime(1500)
    expect(markThreadRead).toHaveBeenLastCalledWith(ROOT, 300)
    rerender({ newest: 400 })
    vi.advanceTimersByTime(1500)
    expect(markThreadRead).toHaveBeenLastCalledWith(ROOT, 400)
    expect(markContainerRead).not.toHaveBeenCalled()
    expect(markFileRead).not.toHaveBeenCalled()
  })

  it('never marks past the clock: a reply dated ahead is read once the clock reaches it', () => {
    vi.setSystemTime(1_000_000 * 1000)
    renderHook(() => useMarkThreadRead(ROOT, 1_000_000 + 600))
    vi.advanceTimersByTime(1500)
    expect(markThreadRead).toHaveBeenLastCalledWith(ROOT, 1_000_001)
    vi.advanceTimersByTime(600 * 1000)
    expect(markThreadRead).toHaveBeenLastCalledWith(ROOT, 1_000_600)
  })

  it('marks nothing for a thread with no replies, or no thread', () => {
    renderHook(() => useMarkThreadRead(ROOT, undefined))
    renderHook(() => useMarkThreadRead(null, 300))
    vi.advanceTimersByTime(5000)
    expect(markThreadRead).not.toHaveBeenCalled()
  })
})
