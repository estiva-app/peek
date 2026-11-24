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
  /** While set, every read waits for it: a read still under way. */
  gate: null as Promise<void> | null,
}))
const viewer = vi.hoisted(() => ({ pubkey: 'c'.repeat(64) }))
vi.mock('@/nostr/foreign', () => ({
  resolveParentsAsViewer: async (references: readonly string[]) => {
    relay.asked.push([...references])
    if (relay.gate) await relay.gate
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
import { FILE_PARENTS_RETRY_MS, loadFileParentsAhead, resetFileParentsForTests, useFileParents } from './useFileParents'

const PK = 'b'.repeat(64)
const I1 = `30851:${PK}:i1`
const I2 = `30851:${PK}:i2`
const I3 = `30851:${PK}:i3`
const PROJECT = `30850:${PK}:project`

beforeEach(() => {
  resetFileParentsForTests()
  relay.asked = []
  relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
  relay.gate = null
  viewer.pubkey = 'c'.repeat(64)
})

/** A read that answers only when `open` is called. */
function holdReads(): () => void {
  let open = () => {}
  relay.gate = new Promise<void>((resolve) => (open = resolve))
  return () => {
    relay.gate = null
    open()
  }
}

const AT = { relayUrl: 'wss://relay.test', token: { pubkey: 'c'.repeat(64), accessToken: 't' } as never }

/*
  THE-4. On a reopen the Desk's loader reads the parents ahead while the rows it drew from the copy ask for theirs:
  each asked for the files the other's read had not answered yet, and the same roots went to the relay twice.
*/
describe('the parents read ahead and a row asking at the same time', () => {
  it('a row drawn while the loader’s read is under way asks nothing again, and shows the parent once it answers', async () => {
    const open = holdReads()
    const ahead = loadFileParentsAhead([I1, I2], AT)
    const { result } = renderHook(() => useFileParents([I1]))
    open()
    await ahead
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT }))
    expect(relay.asked).toEqual([[I1, I2]])
  })

  it('the loader asks only for what no row is asking about, and answers with the row’s parents too', async () => {
    const open = holdReads()
    renderHook(() => useFileParents([I1]))
    await waitFor(() => expect(relay.asked).toEqual([[I1]]))
    const ahead = loadFileParentsAhead([I1, I2], AT)
    open()
    const parents = await ahead
    expect(relay.asked).toEqual([[I1], [I2]])
    expect(Object.fromEntries(parents)).toEqual({ [I1]: PROJECT, [I2]: PROJECT })
  })

  it('a row drawn while the loader’s read is under way asks for itself once that read is refused', async () => {
    // The relay refuses the loader's read, and answers the next.
    let refuse = true
    relay.answer = (references) => {
      if (!refuse) return Object.fromEntries(references.map((reference) => [reference, PROJECT]))
      refuse = false
      return new RelayReadError('rate_limited')
    }
    const open = holdReads()
    const ahead = loadFileParentsAhead([I1], AT)
    const { result } = renderHook(() => useFileParents([I1]))
    expect(relay.asked).toEqual([[I1]])
    open()
    await expect(ahead).rejects.toBeInstanceOf(RelayReadError)
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT }))
    expect(relay.asked).toEqual([[I1], [I1]])
  })

  it('a refused read ahead leaves its files for a row to ask about', async () => {
    relay.answer = () => new RelayReadError('rate_limited')
    await expect(loadFileParentsAhead([I1], AT)).rejects.toBeInstanceOf(RelayReadError)
    relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
    const { result } = renderHook(() => useFileParents([I1]))
    await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT }))
    expect(relay.asked).toEqual([[I1], [I1]])
  })
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

  it('keeps a file the relay could tell nothing about out of the answer, and asks again with the next file named a while later — not before, not by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      relay.answer = () => ({})
      const { result, rerender } = renderHook(({ addresses }) => useFileParents(addresses), {
        initialProps: { addresses: [I1] },
      })
      await waitFor(() => expect(relay.asked).toEqual([[I1]]))
      rerender({ addresses: [I1] })
      expect(result.current).toEqual({})
      relay.answer = (references) => Object.fromEntries(references.map((reference) => [reference, PROJECT]))
      rerender({ addresses: [I1, I2] })
      await waitFor(() => expect(result.current).toEqual({ [I2]: PROJECT }))
      expect(relay.asked).toEqual([[I1], [I2]])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(FILE_PARENTS_RETRY_MS * 3)
      })
      // An idle tab asks nothing: the relay may never answer it.
      expect(relay.asked).toEqual([[I1], [I2]])
      rerender({ addresses: [I1, I2, I3] })
      await waitFor(() => expect(result.current).toEqual({ [I1]: PROJECT, [I2]: PROJECT, [I3]: PROJECT }))
      expect(relay.asked).toEqual([[I1], [I2], [I1, I3]])
    } finally {
      vi.useRealTimers()
    }
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
