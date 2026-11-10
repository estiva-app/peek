// @vitest-environment jsdom
/**
 * AUT-3 — Peek opened offline enters on the expired token the device holds
 * (Miky, 17 Oct). Open work must still come from the copy on the device, and
 * the relay is asked again once a renewal ends that stretch: this hook reads
 * once per mount, and nothing else would ask.
 *
 * `fetchOpenWork` is stood in for; its own reads of the copy and the relay are
 * `openWorkRead.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { OpenWorkBlob, OpenWorkRead, RelaySeam } from './openWork'

const answers: { copy: OpenWorkRead; relay: OpenWorkRead } = { copy: { state: 'absent' }, relay: { state: 'absent' } }
vi.mock('./openWork', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./openWork')>()),
  fetchOpenWork: async (_seam: RelaySeam, source: 'copy' | 'relay' = 'relay') => answers[source],
}))

const { useOpenWorkSync } = await import('./useOpenWorkSync')
const { noteSessionResumed } = await import('@/auth/heldSession')

const blob = (address: string): OpenWorkBlob => ({ v: 1, updatedAt: 1, entries: [{ address } as OpenWorkBlob['entries'][number]] })
const KEPT = blob('30851:aa:kept-on-the-device')
const FRESH = blob('30851:aa:from-the-relay')

beforeEach(() => {
  localStorage.setItem(
    'peek.estivaId.token',
    JSON.stringify({ accessToken: 'expired.token.sig', expiresAt: Date.now() - 60_000, pubkey: 'a'.repeat(64), refreshToken: 'r1' }),
  )
  answers.copy = { state: 'present', blob: KEPT }
  // Offline: the relay read fails at `/sign` and answers nothing.
  answers.relay = { state: 'unreachable' }
})
afterEach(() => localStorage.clear())

describe('open work on a page opened offline (AUT-3)', () => {
  it('draws the list the device holds while the token has expired', async () => {
    const { result } = renderHook(() => useOpenWorkSync('wss://relay.test'))
    await waitFor(() => expect(result.current.cachedBlob).toEqual(KEPT))
    expect(result.current.state).toBe('unknown')
  })

  it('asks the relay again once the renewal lands, and takes its answer', async () => {
    const { result } = renderHook(() => useOpenWorkSync('wss://relay.test'))
    await waitFor(() => expect(result.current.cachedBlob).toEqual(KEPT))

    answers.relay = { state: 'present', blob: FRESH }
    act(() => noteSessionResumed())
    await waitFor(() => expect(result.current.relayBlob).toEqual(FRESH))
    expect(result.current.state).toBe('present')
  })
})
