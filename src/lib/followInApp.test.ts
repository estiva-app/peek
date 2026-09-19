import { describe, expect, it, vi } from 'vitest'
import type { MouseEvent } from 'react'
import { followInApp } from './followInApp'

const click = (init: Partial<MouseEvent<HTMLElement>> = {}) => {
  const event = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...init }
  return event as unknown as MouseEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> }
}

describe('followInApp', () => {
  it('follows a plain left click in place, instead of the browser', () => {
    const go = vi.fn()
    const event = click()
    followInApp(event, go)
    expect(go).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['a middle click', { button: 1 }],
  ])('leaves %s to the browser, so a new tab opens the address', (_, init) => {
    const go = vi.fn()
    const event = click(init)
    followInApp(event, go)
    expect(go).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing when the click was already handled', () => {
    const go = vi.fn()
    followInApp(click({ defaultPrevented: true }), go)
    expect(go).not.toHaveBeenCalled()
  })
})
