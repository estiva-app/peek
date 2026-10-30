/**
 * What reads a message (Katerina, 30 October): being on screen for the dwell,
 * not being drawn. A stand-in IntersectionObserver says what shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { READ_DWELL_MS } from '@/api'
import { useSeenOnScreen } from './useSeenOnScreen'

let observers: { callback: IntersectionObserverCallback; targets: Element[] }[] = []
class FakeObserver {
  targets: Element[] = []
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    observers.push(this)
  }
  observe(target: Element) {
    this.targets.push(target)
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return []
  }
}

/** Says how much of the message `id` shows: its share of the card and its height on screen. */
function show(id: string, ratio: number, height = 60 * ratio) {
  const target = document.querySelector(`[data-msg="${id}"]`)!
  act(() => {
    for (const o of observers) {
      if (!o.targets.includes(target)) continue
      const entry = { target, isIntersecting: ratio > 0, intersectionRatio: ratio, intersectionRect: { height } } as unknown as IntersectionObserverEntry
      o.callback([entry], o as unknown as IntersectionObserver)
    }
  })
}

function List({ ids }: { ids: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeenOnScreen(ref, 'data-msg', 'conversation')
  return (
    <div ref={ref}>
      {ids.map((id) => (
        <p key={id} data-msg={id}>
          {id}
        </p>
      ))}
      <output data-testid="seen">{[...seen].sort().join(',')}</output>
    </div>
  )
}

beforeEach(() => {
  observers = []
  vi.useFakeTimers()
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSeenOnScreen', () => {
  it('a message on screen for the dwell is seen; one never shown is not', () => {
    render(<List ids={['a', 'b']} />)
    show('a', 1)
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS))
    expect(screen.getByTestId('seen').textContent).toBe('a')
  })

  it('scrolling past before the dwell reads nothing', () => {
    render(<List ids={['a']} />)
    show('a', 1)
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS - 100))
    show('a', 0)
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS))
    expect(screen.getByTestId('seen').textContent).toBe('')
  })

  it('a sliver is not enough; half, or enough of a tall card, is', () => {
    render(<List ids={['a', 'b', 'c']} />)
    show('a', 0.2)
    show('b', 0.5)
    show('c', 0.3, 300)
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS))
    expect(screen.getByTestId('seen').textContent).toBe('b,c')
  })

  it('a message drawn later is watched too', () => {
    const { rerender } = render(<List ids={['a']} />)
    rerender(<List ids={['a', 'b']} />)
    show('b', 1)
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS))
    expect(screen.getByTestId('seen').textContent).toBe('b')
  })

  it('a hidden tab reads nothing until it is shown again', () => {
    render(<List ids={['a']} />)
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    show('a', 1)
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS * 2))
    expect(screen.getByTestId('seen').textContent).toBe('')
    hidden.mockReturnValue(false)
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    act(() => void vi.advanceTimersByTime(READ_DWELL_MS))
    expect(screen.getByTestId('seen').textContent).toBe('a')
  })
})
