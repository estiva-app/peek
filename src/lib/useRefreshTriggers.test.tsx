/**
 * PEE-1 / PEE-2 — the refresh triggers.
 *
 * Peek had no polling at all before this, so the things worth pinning are the
 * ones that make polling defensible: it never runs in a hidden tab, and it
 * stands down where the live socket already covers the work.
 */
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REFRESH_INTERVAL_MS, useRefreshTriggers } from './useRefreshTriggers'

function Probe(props: Parameters<typeof useRefreshTriggers>[1] & { onRefresh: () => void }) {
  const { onRefresh, ...options } = props
  useRefreshTriggers(onRefresh, options)
  return null
}

/** jsdom reports `visible` by default; this drives the other case. */
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the interval', () => {
  it('refreshes on a slow timer while visible', () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS)
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('never fires in a hidden tab', () => {
    // Nothing is on screen to be stale, and the waste multiplies by every
    // background tab somebody has left open.
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)

    setVisibility('hidden')
    onRefresh.mockClear()
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 5)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('stands down when the caller says the socket has it', () => {
    // Polling underneath a working live connection would undo M3.
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} interval={false} />)

    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 5)
    expect(onRefresh).not.toHaveBeenCalled()
  })
})

describe('focus and visibility', () => {
  it('refreshes when the tab becomes visible', () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)

    setVisibility('hidden')
    onRefresh.mockClear()
    setVisibility('visible')
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on window focus', () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} />)

    window.dispatchEvent(new Event('focus'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('still fires with the interval stood down', () => {
    // The socket covers the steady state; returning to a tab is the moment
    // somebody actively wants certainty — including when the socket believes it
    // is connected and is not.
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} interval={false} />)

    window.dispatchEvent(new Event('focus'))
    setVisibility('hidden')
    setVisibility('visible')
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })
})

describe('lifecycle', () => {
  it('does nothing at all when disabled', () => {
    const onRefresh = vi.fn()
    render(<Probe onRefresh={onRefresh} enabled={false} />)

    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('removes its listeners and timer on unmount', () => {
    const onRefresh = vi.fn()
    const { unmount } = render(<Probe onRefresh={onRefresh} />)

    unmount()
    window.dispatchEvent(new Event('focus'))
    setVisibility('hidden')
    setVisibility('visible')
    vi.advanceTimersByTime(REFRESH_INTERVAL_MS * 3)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('calls the newest callback without rebinding listeners', () => {
    // A caller passing an inline function must not tear the listeners down on
    // every render — and must still get the current closure when one fires.
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Probe onRefresh={first} />)
    rerender(<Probe onRefresh={second} />)

    window.dispatchEvent(new Event('focus'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
