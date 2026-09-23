/**
 * The Folder listing recovers from a failed read — FOL-42.
 *
 * Read once on mount, a single refused read used to last the session: on
 * production the listing's record read was refused on one page load and a
 * project's channel stayed unplaced, its team's dot dark, until a reload. What
 * is pinned here is the recovery — a retryable failure is read again, a good
 * listing is never replaced by a failure, and a refusal that will not change
 * its mind is not retried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FolderSummary } from '@estiva-app/interop'
import { RelayReadError } from '@/nostr/relayRead'

/* One seam object, the same on every render, so `load` keeps its identity
   and the mount effect runs once (mock-use-relay-viewer-stably). */
const seam = vi.hoisted(() => ({ listFolders: vi.fn<() => Promise<FolderSummary[] | null>>() }))
vi.mock('@/api', () => ({ useForeignObjects: () => seam }))
vi.mock('@/nostr/freshness', () => ({ recordReadFailure: vi.fn() }))

import { FOLDERS_RETRY_FIRST_MS, FOLDERS_RETRY_MAX_MS, useFolders } from './useFolderContents'

const TEAM: FolderSummary = { id: 'team', name: 'Team', hasState: true }
const PLACED: FolderSummary = { id: 'talk', name: 'project-talk', hasState: false, listedIn: ['team'] }

/** Let the pending read settle, and every state update it makes. */
const settle = () => act(async () => {})

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  seam.listFolders.mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useFolders', () => {
  it('reads again after an unreachable relay, and takes the answer', async () => {
    seam.listFolders.mockRejectedValueOnce(new RelayReadError('fetch failed')).mockResolvedValue([TEAM, PLACED])
    const { result } = renderHook(() => useFolders())
    await settle()
    expect(result.current.folders).toEqual([])

    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_FIRST_MS))
    expect(seam.listFolders).toHaveBeenCalledTimes(2)
    expect(result.current.folders).toEqual([TEAM, PLACED])
  })

  it('backs off, doubling to the cap, while the relay keeps failing', async () => {
    seam.listFolders.mockRejectedValue(new RelayReadError('fetch failed'))
    renderHook(() => useFolders())
    await settle()
    expect(seam.listFolders).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_FIRST_MS - 1))
    expect(seam.listFolders).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(seam.listFolders).toHaveBeenCalledTimes(2)
    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_FIRST_MS * 2))
    expect(seam.listFolders).toHaveBeenCalledTimes(3)

    // Far enough on that every wait is the cap: one read per cap, no more.
    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_MAX_MS * 3))
    const before = seam.listFolders.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_MAX_MS))
    expect(seam.listFolders).toHaveBeenCalledTimes(before + 1)
  })

  it('keeps a good listing when a later read fails', async () => {
    seam.listFolders.mockResolvedValueOnce([TEAM, PLACED]).mockRejectedValue(new RelayReadError('fetch failed'))
    const { result } = renderHook(() => useFolders())
    await settle()
    expect(result.current.folders).toEqual([TEAM, PLACED])

    await act(() => result.current.reload())
    expect(result.current.folders).toEqual([TEAM, PLACED])
  })

  it('does not retry a refusal that will answer the same way', async () => {
    seam.listFolders.mockRejectedValue(new RelayReadError('blocked: restricted'))
    renderHook(() => useFolders())
    await settle()
    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_MAX_MS * 2))
    expect(seam.listFolders).toHaveBeenCalledTimes(1)
  })

  it('stops reading once a read succeeds', async () => {
    seam.listFolders.mockRejectedValueOnce(new RelayReadError('fetch failed')).mockResolvedValue([TEAM])
    renderHook(() => useFolders())
    await settle()
    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_FIRST_MS))
    await act(() => vi.advanceTimersByTimeAsync(FOLDERS_RETRY_MAX_MS * 2))
    expect(seam.listFolders).toHaveBeenCalledTimes(2)
  })
})
