/**
 * The short form's one read — FOL-37, FOL-39.
 *
 * `/<word>/<slug>-<d>` carries a file's `d` and no author. These pin the hook
 * that recovers the address: one read per `d`, with the word so the seam can
 * choose the kinds; none for a `d` the session has already seen; and an
 * outage told apart from "nothing has this `d`".
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayReadError } from '@/nostr/relayRead'

const seam = vi.hoisted(() => ({
  resolveFileAddress: vi.fn<(word: string, d: string) => Promise<string | null>>(),
}))
vi.mock('@/api', () => ({ useForeignObjects: () => seam }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))

import { forgetFileAddresses, rememberFileAddress, useFileAddress } from './useForeignConversation'

const PK = 'a'.repeat(64)
const D = '0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f'
const ADDRESS = `30840:${PK}:${D}`

beforeEach(() => {
  seam.resolveFileAddress.mockReset()
  forgetFileAddresses()
})

describe('useFileAddress', () => {
  it('asks once for the author, with the word, and answers the address', async () => {
    seam.resolveFileAddress.mockResolvedValue(ADDRESS)
    const { result, rerender } = renderHook(({ d }: { d: string | null }) => useFileAddress('topic', d), {
      initialProps: { d: D },
    })
    expect(result.current).toBe('loading')
    await waitFor(() => expect(result.current).toEqual({ address: ADDRESS }))
    rerender({ d: D })
    expect(seam.resolveFileAddress).toHaveBeenCalledTimes(1)
    expect(seam.resolveFileAddress).toHaveBeenCalledWith('topic', D)
  })

  it("passes another app's word through — the seam picks the kinds (FOL-39)", async () => {
    const issue = `30851:${PK}:${D}`
    seam.resolveFileAddress.mockResolvedValue(issue)
    const { result } = renderHook(() => useFileAddress('issue', D))
    await waitFor(() => expect(result.current).toEqual({ address: issue }))
    expect(seam.resolveFileAddress).toHaveBeenCalledWith('issue', D)
  })

  it('answers a remembered address without a read', () => {
    rememberFileAddress(ADDRESS)
    const { result } = renderHook(() => useFileAddress('topic', D))
    expect(result.current).toEqual({ address: ADDRESS })
    expect(seam.resolveFileAddress).not.toHaveBeenCalled()
  })

  it('remembers what it read, so a second mount for the same d costs nothing', async () => {
    seam.resolveFileAddress.mockResolvedValue(ADDRESS)
    const first = renderHook(() => useFileAddress('topic', D))
    await waitFor(() => expect(first.result.current).toEqual({ address: ADDRESS }))
    first.unmount()
    const second = renderHook(() => useFileAddress('topic', D))
    expect(second.result.current).toEqual({ address: ADDRESS })
    expect(seam.resolveFileAddress).toHaveBeenCalledTimes(1)
  })

  it('is unresolved for a d no file carries, and does not remember that', async () => {
    seam.resolveFileAddress.mockResolvedValue(null)
    const { result } = renderHook(() => useFileAddress('topic', D))
    await waitFor(() => expect(result.current).toBe('unresolved'))
    // A file started after the miss must be findable: a miss is not cached.
    seam.resolveFileAddress.mockResolvedValue(ADDRESS)
    const again = renderHook(() => useFileAddress('topic', D))
    await waitFor(() => expect(again.result.current).toEqual({ address: ADDRESS }))
  })

  it('tells an outage apart from a miss', async () => {
    seam.resolveFileAddress.mockRejectedValue(new RelayReadError('network'))
    const { result } = renderHook(() => useFileAddress('topic', D))
    await waitFor(() => expect(result.current).toEqual({ failed: 'unreachable' }))
  })

  it('is loading with nothing to resolve', () => {
    const { result } = renderHook(() => useFileAddress('topic', null))
    expect(result.current).toBe('loading')
    expect(seam.resolveFileAddress).not.toHaveBeenCalled()
  })

  it('does not paint a slow answer for one d over the next', async () => {
    let releaseFirst: (a: string | null) => void = () => {}
    seam.resolveFileAddress.mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)))
    const other = '11111111-2222-4333-8444-555555555555'
    seam.resolveFileAddress.mockResolvedValueOnce(`30840:${PK}:${other}`)
    const { result, rerender } = renderHook(({ d }: { d: string }) => useFileAddress('topic', d), {
      initialProps: { d: D },
    })
    rerender({ d: other })
    await waitFor(() => expect(result.current).toEqual({ address: `30840:${PK}:${other}` }))
    await act(async () => releaseFirst(ADDRESS))
    expect(result.current).toEqual({ address: `30840:${PK}:${other}` })
  })
})
