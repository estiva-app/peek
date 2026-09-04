/**
 * INT-8 — the seam that lets a citation reach a conversation nobody opened.
 *
 * Small enough to be worth little on its own; what earns the tests is the
 * failure it exists to prevent. `openConversation` returning true means the
 * *request* was made, not that anything is on screen — and a caller that
 * treats the two as the same ships a click that appears to work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openConversation, registerThreadOpener, unregisterThreadOpener } from './threadOpener'

afterEach(unregisterThreadOpener)

describe('openConversation', () => {
  it('asks the registered view to open it', () => {
    const open = vi.fn()
    registerThreadOpener(open)

    expect(openConversation('t1_c3')).toBe(true)
    expect(open).toHaveBeenCalledWith('t1_c3')
  })

  it('reports false with no view mounted, rather than throwing', () => {
    /*
      A launcher is global: it can be open over the desk, a DM, a people list.
      There is simply nowhere for a conversation to open, and the caller has to
      be able to say so.
    */
    expect(openConversation('t1_c3')).toBe(false)
  })

  it('reports false once the view has gone', () => {
    registerThreadOpener(vi.fn())
    unregisterThreadOpener()

    expect(openConversation('t1_c3')).toBe(false)
  })

  it('lets the newest view win', () => {
    // Navigating between topics re-registers. The stale one must not be the
    // one that answers.
    const old = vi.fn()
    const current = vi.fn()
    registerThreadOpener(old)
    registerThreadOpener(current)

    openConversation('t2_c1')
    expect(old).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledWith('t2_c1')
  })
})
