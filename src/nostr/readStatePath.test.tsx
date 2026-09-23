import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

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
/** Loosely typed: the assertion is about the argument, not the signature. */
const applyRelayReadState = vi.fn<(...args: unknown[]) => Promise<{ applied: number; unresolved: number }>>(
  async () => ({ applied: 1, unresolved: 0 }),
)

vi.mock('./readStateRelay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./readStateRelay')>()),
  loadMergedReadState: () => loadMergedReadState(),
  fetchOwnSlot: async () => ({ reachable: true }),
}))
vi.mock('@/api/store', () => ({ hasConvex: true }))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({
  validToken: () => ({ accessToken: 'tok', pubkey: 'me' }),
  ESTIVA_ID_ORIGIN: 'https://id.estiva.app',
}))
/**
 * One permissive answer for both `useQuery` calls in this module — the relay
 * config (read as `?.relayUrl`) and the cached contexts (read as an array).
 * An array carrying a `relayUrl` satisfies both without the mock having to know
 * which Convex reference it was handed.
 */
const anyQueryResult = Object.assign([] as unknown[], { relayUrl: 'https://relay.test' })
vi.mock('convex/react', () => ({
  useQuery: () => anyQueryResult,
  useMutation: () => applyRelayReadState,
}))
vi.mock('@/lib/debug', () => ({
  useDebug: () => ({ state: { readState: { dualRun: true } }, setReadStateDiff: vi.fn() }),
}))

describe('ReadStateSync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches and merges on mount, rather than exporting a hook nobody calls', async () => {
    const { ReadStateSync } = await import('./useReadStateSync')
    render(<ReadStateSync />)
    // One microtask for the effect's async refresh.
    await new Promise((r) => setTimeout(r, 0))
    expect(loadMergedReadState).toHaveBeenCalled()
  })

  it('writes what it merged into the horizon cache', async () => {
    const { ReadStateSync } = await import('./useReadStateSync')
    render(<ReadStateSync />)
    await new Promise((r) => setTimeout(r, 0))
    expect(applyRelayReadState).toHaveBeenCalled()
    const arg = applyRelayReadState.mock.calls[0][0] as {
      contexts: { context: string; atSeconds: number }[]
    }
    expect(arg.contexts).toEqual([
      { context: 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91', atSeconds: 1000 },
    ])
  })
})
