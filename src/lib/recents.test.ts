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
})
