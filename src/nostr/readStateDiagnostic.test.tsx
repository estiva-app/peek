import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

/**
 * The field that would have caught three tickets' worth of dead code.
 *
 * `useMergedReadState` was written by CRO-5, given a cache by CRO-6 and a diff by
 * CRO-7, and mounted by none of them. Every ticket was green. One command
 * answering "the merge has never executed" would have ended it immediately.
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

const diag = () => (window as unknown as { __readState: () => Record<string, unknown> }).__readState()

describe('window.__readState()', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { resetReadStateQueueForTests } = await import('./useReadStateSync')
    resetReadStateQueueForTests()
  })

  it('reports hasRun false before the read path has executed', async () => {
    const { installReadStateDiagnostic } = await import('./useReadStateSync')
    installReadStateDiagnostic()
    const d = diag()
    expect(d.hasRun).toBe(false)
    expect(d.mergeRuns).toBe(0)
    // The dead-path signature: nothing has run and nothing says why.
    expect(d.queue).toBe('queue not created yet')
  })

  it('reports hasRun true once the merge has run, with what it saw', async () => {
    const { installReadStateDiagnostic, ReadStateSync } = await import('./useReadStateSync')
    installReadStateDiagnostic()
    render(<ReadStateSync />)
    await new Promise((r) => setTimeout(r, 0))

    const d = diag()
    expect(d.hasRun).toBe(true)
    expect(d.mergeRuns).toBeGreaterThan(0)
    expect(d.relayContexts).toBe(1)
    expect(typeof d.lastMergeAt).toBe('string')
  })

  it('names the slot it publishes to', async () => {
    const { installReadStateDiagnostic } = await import('./useReadStateSync')
    installReadStateDiagnostic()
    expect(String(diag().slot)).toMatch(/^read-state:[0-9a-f]{32}$/)
  })

  /**
   * SHR-3 asked for the blob's size and got a context count, because that was
   * the only number exposed. A count cannot answer it: the binding limit is a
   * byte cap on the plaintext, and the key kinds differ by more than 2× in cost.
   */
  it('measures the merged frontier in bytes, not in contexts', async () => {
    const { installReadStateDiagnostic, ReadStateSync } = await import('./useReadStateSync')
    installReadStateDiagnostic()
    render(<ReadStateSync />)
    await new Promise((r) => setTimeout(r, 0))

    const d = diag()
    // One bare-uuid container plus the {v, client_id, contexts} envelope.
    expect(d.relayContexts).toBe(1)
    expect(d.blobBytes).toBeGreaterThan(50)
    expect(d.blobPctOfCeiling).toBeLessThan(1)
    expect(d.keySplit).toEqual({ container: 1, file: 0, thread: 0, msg: 0, other: 0 })
  })

  it('reports an empty frontier as the envelope, never as zero bytes', async () => {
    const { installReadStateDiagnostic } = await import('./useReadStateSync')
    installReadStateDiagnostic()
    const d = diag()
    expect(d.relayContexts).toBe(0)
    // 49 bytes of envelope was mistaken for a measurement once; it is the floor.
    expect(d.blobBytes).toBeGreaterThan(0)
    expect(d.keySplit).toEqual({ container: 0, file: 0, thread: 0, msg: 0, other: 0 })
  })
})

describe('splitReadStateKeys', () => {
  const UUID = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
  const HEX = 'a'.repeat(64)

  it('separates the four kinds readState.ts constructs', async () => {
    const { splitReadStateKeys } = await import('./useReadStateSync')
    expect(
      splitReadStateKeys({
        [UUID]: 1,
        [`39000:${HEX}:${UUID}`]: 1,
        [`thread:${HEX}`]: 1,
        [`msg:${HEX}`]: 1,
      }),
    ).toEqual({ container: 1, file: 1, thread: 1, msg: 1, other: 0 })
  })

  it('counts anything else as other, because that is a defect and not a kind', async () => {
    const { splitReadStateKeys } = await import('./useReadStateSync')
    expect(splitReadStateKeys({ 'file:something': 1 }).other).toBe(1)
  })
})
