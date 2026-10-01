import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const markFileRead = vi.fn()
vi.mock('@/api', () => ({
  READ_DWELL_MS: 1500,
  useReadActions: () => ({ markFileRead, markContainerRead: vi.fn(), markThreadRead: vi.fn() }),
}))

const { useMarkFileRead } = await import('./useMarkRead')

const FILE = `30851:${'e'.repeat(64)}:issue`

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useMarkFileRead (PEE-44)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    markFileRead.mockClear()
    setHidden(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    // Back to jsdom's own getter, so no later test reads the stub.
    delete (document as { hidden?: boolean }).hidden
  })

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
})
