import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/*
  FOL-50. The dots ask each file's parent once per viewer per tab: the read is
  ~500 KB for production's 110 issues, and the socket signals many times a
  minute. What this pins is the asking — once, only what is new, again after a
  refusal, afresh for another viewer. Where the answer places a message is
  `teamUnread.test.ts`'s.
*/
const relay = vi.hoisted(() => ({
  asked: [] as string[][],
  answer: (references: readonly string[]): Record<string, string | null> | Error =>
    Object.fromEntries(references.map((reference) => [reference, null])),
}))
const viewer = vi.hoisted(() => ({ pubkey: 'c'.repeat(64) }))
vi.mock('@/nostr/foreign', () => ({
  resolveParentsAsViewer: async (references: readonly string[]) => {
    relay.asked.push([...references])
    const answer = relay.answer(references)
    if (answer instanceof Error) throw answer
    return answer
  },
}))
vi.mock('./foreign', async () => {
  const { useCallback } = await import('react')
  return {
    useRelayViewer: () =>
      useCallback(() => ({ relayUrl: 'wss://relay.test', token: { pubkey: viewer.pubkey, accessToken: 't' } }), []),
  }
})
vi.mock('@/nostr/liveTopics', () => ({ relayLog: () => {} }))

import { RelayReadError } from '@/nostr/relayRead'
import { FILE_PARENTS_RETRY_MS, resetFileParentsForTests, useFileParents } from './useFileParents'

const PK = 'b'.repeat(64)
const I1 = `30851:${PK}:i1`
const I2 = `30851:${PK}:i2`
const PROJECT = `30850:${PK}:project`

beforeEach(() => {
  resetFileParentsForTests()
  relay.asked = []
  relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
  viewer.pubkey = 'c'.repeat(64)
})

describe('useFileParents', () => {
  it('asks once, and answers every mount from what it learned', async () => {
    const { result } = renderHook(() => useFileParents([I1]))
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT }))
    const second = renderHook(() => useFileParents([I1]))
    expect(second.result.current).toEqual({ [I1]: PROJECT })
    expect(relay.asked).toEqual([[I1]])
  })

  it('asks only for the files it has not asked about', async () => {
    const { result, rerender } = renderHook(({ addresses }) => useFileParents(addresses), {
      initialProps: { addresses: [I1] },
    })
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT }))
    rerender({ addresses: [I2, I1] })
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT, [I2]: PROJECT }))
    expect(relay.asked).toEqual([[I1], [I2]])
  })

  it('keeps a file the relay could tell nothing about out of the answer, and asks again with the next file', async () => {
    relay.answer = () => ({})
    const { result, rerender } = renderHook(({ addresses }) => useFileParents(addresses), {
      initialProps: { addresses: [I1] },
    })
    await waitFor(() => expect(relay.asked).toEqual([[I1]]))
    rerender({ addresses: [I1] })
    expect(result.current).toEqual({})
    expect(relay.asked).toEqual([[I1]])
    relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
    rerender({ addresses: [I1, I2] })
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT, [I2]: PROJECT }))
    expect(relay.asked).toEqual([[I1], [I1, I2]])
  })

  it('asks again after a refused read, on the next change in what is named', async () => {
    relay.answer = () => new RelayReadError('refused: not a member')
    const { result, rerender } = renderHook(({ addresses }) => useFileParents(addresses), {
      initialProps: { addresses: [I1] },
    })
    await waitFor(() => expect(relay.asked).toEqual([[I1]]))
    expect(result.current).toEqual({})
    relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
    rerender({ addresses: [I1, I2] })
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT, [I2]: PROJECT }))
    expect(relay.asked).toEqual([[I1], [I1, I2]])
  })

  it('asks again a while after a refused read, with nothing new named', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      relay.answer = () => new RelayReadError('refused: not a member')
      const { result } = renderHook(() => useFileParents([I1]))
      await waitFor(() => expect(relay.asked).toEqual([[I1]]))
      relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
      act(() => {
        vi.advanceTimersByTime(FILE_PARENTS_RETRY_MS)
      })
      await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT }))
      expect(relay.asked).toEqual([[I1], [I1]])
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts afresh for another viewer', async () => {
    const first = renderHook(() => useFileParents([I1]))
    await waitFor(() => expect(first.result.current).toEqual({ [I1]: PROJECT }))
    first.unmount()
    viewer.pubkey = 'e'.repeat(64)
    const second = renderHook(() => useFileParents([I1]))
    await waitFor(() => expect(relay.asked).toEqual([[I1], [I1]]))
    await waitFor(() => expect(second.result.current).toEqual({ [I1]: PROJECT }))
  })

  it('asks nothing for no files', () => {
    const { result } = renderHook(() => useFileParents([]))
    expect(result.current).toEqual({})
    expect(relay.asked).toEqual([])
  })
})
