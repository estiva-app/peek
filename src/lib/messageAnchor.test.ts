/**
 * INT-3 — a citation has to land on the message, not near it.
 *
 * The point of a citation is that a claim is checkable in one click. A click
 * that scrolls somewhere plausible and marks nothing delivers a scroll
 * position; a click that silently does nothing is worse than a row that was
 * never offered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollToMessage } from './messageAnchor'

let scrollIntoView: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  document.body.innerHTML = `
    <div data-reply-id="r1">first</div>
    <div data-reply-id="r2">second</div>
  `
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('scrollToMessage', () => {
  it('scrolls the cited message into the middle of the view', () => {
    // Centred rather than to the top: the messages around it are the context
    // that makes the cited one checkable.
    expect(scrollToMessage('r2')).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('marks the message it arrived at', () => {
    // The scroll lands mid-thread and the message has to be identifiable, or
    // the click delivers a position rather than a message.
    scrollToMessage('r1')
    expect(document.querySelector('[data-reply-id="r1"]')).toHaveAttribute('data-cited', 'true')
  })

  it('clears the mark, because it marks an arrival and not a state', () => {
    scrollToMessage('r1')
    vi.advanceTimersByTime(2000)
    expect(document.querySelector('[data-reply-id="r1"]')).not.toHaveAttribute('data-cited')
  })

  it('does not clear a mark a later citation has claimed', () => {
    /*
      Two citations clicked in quick succession: the first one's timer must not
      unmark the second one's message. Same element is the interesting case —
      the timer is keyed to the element, not to the call.
    */
    scrollToMessage('r1')
    vi.advanceTimersByTime(1000)
    scrollToMessage('r1')
    vi.advanceTimersByTime(1000)

    // The second click's mark is still inside its own window.
    expect(document.querySelector('[data-reply-id="r1"]')).toHaveAttribute('data-cited', 'true')
  })

  it('reports false for a message that is not on screen', () => {
    /*
      A thread paginates. A cited message can sit above the loaded window, and
      the caller has to be able to tell that from a successful scroll — doing
      nothing quietly is the one option it must not have.
    */
    expect(scrollToMessage('r99')).toBe(false)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does not break on an id with quotes in it', () => {
    // Ids come off the relay. A selector built by concatenation would throw.
    document.body.innerHTML = `<div data-reply-id='a"b'>odd</div>`
    expect(scrollToMessage('a"b')).toBe(true)
  })
})
