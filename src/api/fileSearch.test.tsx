/**
 * The launcher's Files (SUM-7): typing part of a file's title finds it, ranked
 * as `[` ranks the same files, and one letter asks the relay nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReferenceCandidate } from '@estiva-app/conversation'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }), storedToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }) }))

const relay = vi.hoisted(() => ({
  search: vi.fn<(term: string) => Promise<ReferenceCandidate[]>>(async () => []),
}))
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  searchFileReferencesAsViewer: (term: string) => relay.search(term),
}))

import { useFileSearch } from './foreign'

const AUTHOR = 'a'.repeat(64)
const hit = (d: string, title: string): ReferenceCandidate => ({
  id: `30851:${AUTHOR}:${d}`,
  uri: `nostr:${d}`,
  type: 'issue',
  kind: 30851,
  title,
  caption: 'Finance',
  tier: 2,
})
/** Past the launcher's typing pause, letting the relay's answer land. */
const pause = () => act(() => vi.advanceTimersByTimeAsync(300))

beforeEach(() => {
  vi.useFakeTimers()
  relay.search.mockReset()
  relay.search.mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useFileSearch', () => {
  it('puts the title that starts with what was typed before one that only holds it, whatever order the relay answered in', async () => {
    relay.search.mockResolvedValue([hit('old', 'Old ledger notes'), hit('rec', 'Ledger reconciliation')])
    const { result } = renderHook(() => useFileSearch('ledger'))
    await pause()
    expect(result.current.state).toEqual({ kind: 'done', count: 2 })
    expect(result.current.hits.map((h) => h.title)).toEqual(['Ledger reconciliation', 'Old ledger notes'])
  })

  it('while a new word is searched, shows none of the files the earlier word found', async () => {
    relay.search.mockResolvedValueOnce([hit('rec', 'Ledger reconciliation')])
    const { result, rerender } = renderHook(({ q }) => useFileSearch(q), { initialProps: { q: 'ledger' } })
    await pause()
    expect(result.current.hits).toHaveLength(1)

    relay.search.mockImplementation(() => new Promise(() => {}))
    rerender({ q: 'notes' })
    await pause()
    expect(result.current.state).toEqual({ kind: 'searching' })
    expect(result.current.hits).toEqual([])
  })

  it('asks the relay nothing for one letter', async () => {
    const { result } = renderHook(() => useFileSearch('l'))
    await pause()
    expect(relay.search).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ kind: 'idle' })
  })
})
