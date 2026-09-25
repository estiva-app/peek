import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'

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
const loadMergedReadState = vi.fn(async () => ({
  merged: { 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91': 1000 },
  verdict: { mine: undefined, staleDuplicates: [], coordinateConflicted: false },
}))

vi.mock('./readStateRelay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./readStateRelay')>()),
  loadMergedReadState: () => loadMergedReadState(),
  fetchOwnSlot: async () => ({ reachable: true }),
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({
  validToken: () => ({ accessToken: 'tok', pubkey: 'me' }),
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
    expect(result.current.marker('b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91')).toBe(1000)
  })
})
