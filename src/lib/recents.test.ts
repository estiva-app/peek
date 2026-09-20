// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { clearRecents, forgetRecent, rememberRecent, resetRecentsForTests, useRecents } from './recents'

beforeEach(() => {
  window.localStorage.clear()
  resetRecentsForTests()
})

describe('recents', () => {
  it('lists what was opened, newest first, once each', () => {
    rememberRecent({ kind: 'topic', id: 'a' })
    rememberRecent({ kind: 'person', id: 'p' })
    rememberRecent({ kind: 'topic', id: 'a' })
    const { result } = renderHook(() => useRecents())
    expect(result.current).toEqual([
      { kind: 'topic', id: 'a' },
      { kind: 'person', id: 'p' },
    ])
  })

  it('keeps a topic and a person with the same id apart', () => {
    rememberRecent({ kind: 'topic', id: 'x' })
    rememberRecent({ kind: 'person', id: 'x' })
    const { result } = renderHook(() => useRecents())
    expect(result.current).toHaveLength(2)
  })

  it('forgets one, and clears them all, and the hook follows', () => {
    rememberRecent({ kind: 'topic', id: 'a' })
    rememberRecent({ kind: 'topic', id: 'b' })
    const { result } = renderHook(() => useRecents())
    act(() => forgetRecent({ kind: 'topic', id: 'b' }))
    expect(result.current).toEqual([{ kind: 'topic', id: 'a' }])
    act(() => clearRecents())
    expect(result.current).toEqual([])
  })

  it('outlives the page', () => {
    rememberRecent({ kind: 'topic', id: 'a' })
    resetRecentsForTests()
    const { result } = renderHook(() => useRecents())
    expect(result.current).toEqual([{ kind: 'topic', id: 'a' }])
  })

  it('reads a broken entry as nothing rather than failing', () => {
    window.localStorage.setItem('estiva-peek:recents', '{not json')
    const { result } = renderHook(() => useRecents())
    expect(result.current).toEqual([])
  })

  /*
    A file carries its title (FOL-36): there is no live list to read one from,
    and the alternative is a resolve per recent file every time the launcher
    opens. Opening the file again is the only refresh the title gets.
  */
  it('keeps a file with its title, and refreshes the title when it is opened again', () => {
    const address = '30840:' + 'a'.repeat(64) + ':0f7d2c1e'
    rememberRecent({ kind: 'file', id: address, title: 'Before' })
    rememberRecent({ kind: 'file', id: address, title: 'After the rename' })
    const { result } = renderHook(() => useRecents())
    expect(result.current).toEqual([{ kind: 'file', id: address, title: 'After the rename' }])
    act(() => forgetRecent({ kind: 'file', id: address }))
    expect(result.current).toEqual([])
  })

  it('drops a stored file without a title, which nothing could draw', () => {
    window.localStorage.setItem('estiva-peek:recents', JSON.stringify([{ kind: 'file', id: 'x' }, { kind: 'topic', id: 'a' }]))
    const { result } = renderHook(() => useRecents())
    expect(result.current).toEqual([{ kind: 'topic', id: 'a' }])
  })
})
