/**
 * Cards showing one block share one poll, and none reads while the relay has
 * asked clients to pause (COM-2 security review: per-card polling).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'

const resolve = vi.hoisted(() => vi.fn())
const paused = vi.hoisted(() => ({ ms: 0 }))
vi.mock('./relayUrl', () => ({ RELAY_URL: 'https://estiva.example', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'a'.repeat(64) }) }))
vi.mock('@/nostr/relayBudget', () => ({ relayBudget: { pausedForMs: () => paused.ms } }))
vi.mock('@/nostr/foreign', () => ({
  resolveObjectAsViewer: resolve,
  absenceAsViewer: async () => 'unreadable',
  blockLinkAsViewer: async () => undefined,
}))

import { usePart } from './part'

const ADDRESS = `30851:${'f'.repeat(64)}:b4ea696a-d4a2-4833-8f2a-6aa1e2f3c4d5`
function Probe() {
  return <span>{usePart({ address: ADDRESS, block: 'p1' }).state}</span>
}

afterEach(() => {
  resolve.mockReset()
  paused.ms = 0
})

describe('usePart', () => {
  it('reads once for two cards on the same block', async () => {
    resolve.mockResolvedValue(null)
    const { getAllByText } = render(
      <>
        <Probe />
        <Probe />
      </>,
    )
    await waitFor(() => expect(getAllByText('unreadable')).toHaveLength(2))
    expect(resolve).toHaveBeenCalledOnce()
  })

  it('does not read while the relay has asked for a pause', async () => {
    paused.ms = 5_000
    const { unmount } = render(<Probe />)
    await new Promise((r) => setTimeout(r, 20))
    expect(resolve).not.toHaveBeenCalled()
    unmount()
  })
})
