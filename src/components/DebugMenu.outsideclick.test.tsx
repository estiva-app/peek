import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DebugMenu } from './DebugMenu'

/**
 * A menu must not be closed by the click that opened it.
 *
 * Observed on production with a MutationObserver: the panel was ADDED and
 * REMOVED 1ms apart. React flushes effects during a discrete event, so a
 * `mousedown` listener attached synchronously on mount catches the very event
 * still bubbling towards `document` — and the opener is not inside the menu or
 * its anchor, so it closes instantly. It reads as the button doing nothing.
 *
 * It only worked before because the opener WAS the anchor, so `contains` bailed.
 *
 * jsdom does not reproduce the original timing, so this pins the property the
 * fix guarantees instead: same tick cannot close it, a later mousedown can.
 */
vi.mock('@/api', () => ({ hasConvex: true }))
vi.mock('@/lib/debug', () => ({
  useDebug: () => ({
    state: { readState: { dualRun: true }, desk: {}, unreads: {} },
    setDesk: vi.fn(), setUnreads: vi.fn(), setReadState: vi.fn(),
    readStateDiff: null,
  }),
}))

describe('DebugMenu outside-click', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  const anchor = () => {
    const el = document.createElement('button')
    document.body.appendChild(el)
    return el
  }
  const outside = () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    return el
  }

  it('ignores a mousedown in the same tick as mount', () => {
    const onClose = vi.fn()
    render(<DebugMenu anchorEl={anchor()} onClose={onClose} />)
    outside().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still closes on a mousedown after that tick', () => {
    const onClose = vi.fn()
    render(<DebugMenu anchorEl={anchor()} onClose={onClose} />)
    vi.advanceTimersByTime(1)
    outside().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalled()
  })

  it('does not close on a mousedown inside itself', () => {
    const onClose = vi.fn()
    render(<DebugMenu anchorEl={anchor()} onClose={onClose} />)
    vi.advanceTimersByTime(1)
    screen.getByText('Read state').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
  })
})
