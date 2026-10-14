/**
 * A record with no `h` still resolves with a Folder — PEE-33.
 *
 * A Ship project is placed under its team by a `kind:1852`, so its record
 * carries no `h` and the projection reports no `folder`; its conversation
 * lives in the channel its own record names. These pin that the hook asks
 * for that Folder once, only for such a file, and that a record naming none
 * comes back as it resolved rather than with a guess.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => ({
  resolveObject: vi.fn<(naddr: string) => Promise<ForeignObject | null>>(),
  resolveFileFolder: vi.fn<(address: string) => Promise<string | null>>(),
  // The copy on the device holds no file unless a case says so (PEE-4).
  resolveObjectFromDevice: vi.fn<(naddr: string) => Promise<ForeignObject | undefined>>(async () => undefined),
}))
vi.mock('@/api', () => ({ useForeignObjects: () => seam }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))

import { useForeignConversation } from './useForeignConversation'
import { RelayReadError } from '@/nostr/relayRead'

const SHIP = 'b'.repeat(64)
const PROJECT = `30850:${SHIP}:ef024737-6b8f-4e79-ab16-f56fbf7898f2`
const ISSUE = `30851:${SHIP}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const TEAM = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const CHANNEL = '2611db6d-57f0-4f39-a454-a198298b526f'

const foreign = (over: Partial<ForeignObject>): ForeignObject =>
  ({ naddr: 'naddr1x', eventId: 'e'.repeat(64), widget: 'card', slots: {}, meta: [], comments: [], actions: [], ...over }) as unknown as ForeignObject

beforeEach(() => {
  seam.resolveObject.mockReset()
  seam.resolveFileFolder.mockReset()
  seam.resolveObjectFromDevice.mockReset().mockResolvedValue(undefined)
})

describe('useForeignConversation draws a file from the copy on the device until the relay answers (PEE-4)', () => {
  it('the copy’s file first, then the relay’s', async () => {
    let answer: (object: ForeignObject | null) => void = () => {}
    seam.resolveObject.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    seam.resolveObjectFromDevice.mockResolvedValue(foreign({ ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM, slots: { title: { value: 'Copied' } } }))
    const { result } = renderHook(() => useForeignConversation(ISSUE))
    await waitFor(() => expect(result.current.state).toMatchObject({ address: ISSUE, slots: { title: { value: 'Copied' } } }))
    await act(async () => answer(foreign({ ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM, slots: { title: { value: 'Live' } } })))
    expect(result.current.state).toMatchObject({ slots: { title: { value: 'Live' } } })
  })

  it('a Folder the viewer has lost is said, not drawn from the copy', async () => {
    seam.resolveObject.mockRejectedValue(new RelayReadError('relay_membership_required'))
    seam.resolveObjectFromDevice.mockResolvedValue(foreign({ ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM }))
    const { result } = renderHook(() => useForeignConversation(ISSUE))
    await waitFor(() => expect(result.current.state).toEqual({ failed: 'not_a_member' }))
  })

  it('a file the relay no longer resolves replaces the copy’s, and a file with no Folder is not drawn from it', async () => {
    let answer: (object: ForeignObject | null) => void = () => {}
    seam.resolveObject.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    seam.resolveObjectFromDevice.mockResolvedValue(foreign({ ref: PROJECT, address: PROJECT, kind: 30850 }))
    const { result } = renderHook(() => useForeignConversation(PROJECT))
    await act(async () => {})
    expect(result.current.state).toBe('loading')
    await act(async () => answer(null))
    expect(result.current.state).toBe('unresolved')
  })
})

describe('useForeignConversation fills the Folder of a record that carries no h', () => {
  it('a project: one more read, and the state carries the channel the record names', async () => {
    seam.resolveObject.mockResolvedValue(foreign({ ref: PROJECT, address: PROJECT, kind: 30850 }))
    seam.resolveFileFolder.mockResolvedValue(CHANNEL)
    const { result } = renderHook(() => useForeignConversation(PROJECT))
    await waitFor(() => expect(result.current.state).toMatchObject({ address: PROJECT, folder: CHANNEL }))
    expect(seam.resolveFileFolder).toHaveBeenCalledTimes(1)
    expect(seam.resolveFileFolder).toHaveBeenCalledWith(PROJECT)
  })

  it('an issue resolved with its h, and the read is not made', async () => {
    seam.resolveObject.mockResolvedValue(foreign({ ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM }))
    const { result } = renderHook(() => useForeignConversation(ISSUE))
    await waitFor(() => expect(result.current.state).toMatchObject({ address: ISSUE, folder: TEAM }))
    expect(seam.resolveFileFolder).not.toHaveBeenCalled()
  })

  it('a record naming no Folder at all resolves as it is — no guess', async () => {
    seam.resolveObject.mockResolvedValue(foreign({ ref: PROJECT, address: PROJECT, kind: 30850 }))
    seam.resolveFileFolder.mockResolvedValue(null)
    const { result } = renderHook(() => useForeignConversation(PROJECT))
    await waitFor(() => expect(result.current.state).toMatchObject({ address: PROJECT }))
    expect((result.current.state as ForeignObject).folder).toBeUndefined()
  })

  it('an unresolved reference is not asked for a Folder', async () => {
    seam.resolveObject.mockResolvedValue(null)
    const { result } = renderHook(() => useForeignConversation(PROJECT))
    await waitFor(() => expect(result.current.state).toBe('unresolved'))
    expect(seam.resolveFileFolder).not.toHaveBeenCalled()
  })
})

describe('useForeignConversation holds what it resolved past the component (SID-2)', () => {
  it('a file opened a second time draws at once, and a fresh answer is not asked again', async () => {
    const issue = foreign({ ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM })
    seam.resolveObject.mockResolvedValue(issue)
    const first = renderHook(() => useForeignConversation(ISSUE))
    await waitFor(() => expect(first.result.current.state).toBe(issue))
    first.unmount()
    const second = renderHook(() => useForeignConversation(ISSUE))
    expect(second.result.current.state).toBe(issue)
    expect(seam.resolveObject).toHaveBeenCalledTimes(1)
  })
})

describe('useForeignConversation keeps the last file while the next resolves (SID-2)', () => {
  it('holds the last answer as `previous` while the next address loads, and only then', async () => {
    const issue = foreign({ ref: ISSUE, address: ISSUE, kind: 30851, folder: TEAM })
    seam.resolveObject.mockResolvedValueOnce(issue)
    const { result, rerender } = renderHook(({ naddr }) => useForeignConversation(naddr), {
      initialProps: { naddr: ISSUE },
    })
    await waitFor(() => expect(result.current.state).toBe(issue))
    expect(result.current.previous).toBeNull()

    let answer: (object: ForeignObject | null) => void = () => {}
    seam.resolveObject.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    seam.resolveFileFolder.mockResolvedValue(CHANNEL)
    rerender({ naddr: PROJECT })
    expect(result.current.state).toBe('loading')
    expect(result.current.previous).toBe(issue)

    answer(foreign({ ref: PROJECT, address: PROJECT, kind: 30850 }))
    await waitFor(() => expect(result.current.state).toMatchObject({ address: PROJECT }))
    expect(result.current.previous).toBeNull()
  })
})
