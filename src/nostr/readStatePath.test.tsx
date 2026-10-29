import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, renderHook, waitFor } from '@testing-library/react'

/**
 * The read path runs at all.
 *
 * `useMergedReadState` was written by CRO-5, given a horizon cache to fill by
 * CRO-6 and a dual-run diff by CRO-7, and mounted by none of them — every
 * ticket ended "nothing consumes it yet, that is the next one", and the next one
 * added to it instead of turning it on. Publishing worked the whole time, which
 * is why nothing looked broken: the half that was dead was the half with no
 * visible output yet.
 *
 * So this asserts the least interesting thing in the file, and the one that was
 * actually missing.
 */
const READ = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
const merge = (merged: Record<string, number>, complete = true) => ({
  merged,
  complete,
  verdict: { mine: undefined, staleDuplicates: [], coordinateConflicted: false },
})
const loadMergedReadState = vi.fn(async (..._args: unknown[]) => merge({ [READ]: 1000 }))

vi.mock('./readStateRelay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./readStateRelay')>()),
  loadMergedReadState: (...args: unknown[]) => loadMergedReadState(...args),
  fetchOwnSlot: async () => ({ reachable: true }),
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({
  validToken: () => ({ accessToken: 'tok', pubkey: 'me' }),
  storedToken: () => ({ accessToken: 'tok', pubkey: 'me' }),
  ESTIVA_ID_ORIGIN: 'https://id.estiva.app',
}))

describe('ReadStateSync', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { resetReadStateQueueForTests } = await import('./useReadStateSync')
    resetReadStateQueueForTests()
  })

  it('fetches and merges on mount, rather than exporting a hook nobody calls', async () => {
    const { ReadStateSync } = await import('./useReadStateSync')
    render(<ReadStateSync />)
    // One microtask for the effect's async refresh.
    await new Promise((r) => setTimeout(r, 0))
    expect(loadMergedReadState).toHaveBeenCalled()
  })

  it('hands the merge to the frontier the dots are judged from', async () => {
    const { ReadStateSync, useReadFrontier } = await import('./useReadStateSync')
    render(<ReadStateSync />)
    const { result } = renderHook(() => useReadFrontier())
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.marker(READ)).toBe(1000)
  })

  /*
   * PEE-68: a new tab refused (429) a slot it had never decrypted merged
   * without it, so a file read in Ship showed in the Screener as new and left
   * at the next refresh. Nothing is judged until a merge holds every slot.
   */
  it('a merge missing a refused slot is not judged on, and is read again soon (PEE-68)', async () => {
    vi.useFakeTimers()
    try {
      // The copy on the device and the relay's first round both miss the slot that read READ.
      loadMergedReadState.mockImplementation(async () => merge({}, false))
      const { ReadStateSync, useReadFrontier, READ_AGAIN_MS } = await import('./useReadStateSync')
      render(<ReadStateSync />)
      const { result } = renderHook(() => useReadFrontier())
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(result.current.ready).toBe(false)

      loadMergedReadState.mockImplementation(async () => merge({ [READ]: 1000 }))
      await act(() => vi.advanceTimersByTimeAsync(READ_AGAIN_MS))
      expect(result.current.ready).toBe(true)
      expect(result.current.marker(READ)).toBe(1000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a copy on the device missing a slot is not drawn while the relay answers (PEE-68)', async () => {
    // The copy misses the slot that read READ; the relay has not answered yet.
    loadMergedReadState.mockImplementation((...args: unknown[]) =>
      args[4] === 'copy' ? Promise.resolve(merge({}, false)) : new Promise(() => {}),
    )
    const { ReadStateSync, useReadFrontier } = await import('./useReadStateSync')
    render(<ReadStateSync />)
    const { result } = renderHook(() => useReadFrontier())
    await waitFor(() => expect(loadMergedReadState).toHaveBeenCalledTimes(2))
    await act(() => Promise.resolve())
    expect(result.current.ready).toBe(false)
  })

  it('a slot refused every time does not keep the Screener and dots blank: after a few re-reads the tab takes what decrypted', async () => {
    vi.useFakeTimers()
    try {
      loadMergedReadState.mockImplementation(async () => merge({ [READ]: 1000 }, false))
      const { ReadStateSync, useReadFrontier, READ_AGAIN_MS, READ_AGAIN_TIMES } = await import('./useReadStateSync')
      render(<ReadStateSync />)
      const { result } = renderHook(() => useReadFrontier())
      await act(() => vi.advanceTimersByTimeAsync(0))
      expect(result.current.ready).toBe(false)

      await act(() => vi.advanceTimersByTimeAsync(READ_AGAIN_MS * (READ_AGAIN_TIMES + 1)))
      expect(result.current.ready).toBe(true)
      expect(result.current.marker(READ)).toBe(1000)
    } finally {
      vi.useRealTimers()
    }
  })
})
