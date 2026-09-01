import { describe, expect, it, vi } from 'vitest'
import { createForeignActivity } from './foreignActivity'

describe('foreign activity', () => {
  it('tells a folder’s listeners and nobody else', () => {
    const activity = createForeignActivity()
    const mine = vi.fn()
    const theirs = vi.fn()
    activity.watch('folder-a', mine)
    activity.watch('folder-b', theirs)

    activity.notify('folder-a')
    expect(mine).toHaveBeenCalledTimes(1)
    expect(theirs).not.toHaveBeenCalled()
  })

  it('is safe for a folder nobody watches', () => {
    // Every channel the socket delivers goes through this, and most of them
    // have no panel open.
    expect(() => createForeignActivity().notify('nobody-here')).not.toThrow()
  })

  it('stops after unsubscribe, and unsubscribing twice is harmless', () => {
    const activity = createForeignActivity()
    const listener = vi.fn()
    const off = activity.watch('f', listener)
    off()
    off()
    activity.notify('f')
    expect(listener).not.toHaveBeenCalled()
  })

  it('one listener throwing does not stop the others', () => {
    // These run inside the socket's flush. A component that throws must not
    // surface as a relay failure somewhere unrelated.
    const activity = createForeignActivity()
    const after = vi.fn()
    activity.watch('f', () => {
      throw new Error('a component problem')
    })
    activity.watch('f', after)
    expect(() => activity.notify('f')).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
  })
})
