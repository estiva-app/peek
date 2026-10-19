/**
 * What the conversation hook draws while a file resolves: the copy on the
 * device first (PEE-4), the last file held while the next one loads, and what
 * it resolved kept past the component (SID-2). A record with no `h` — a Ship
 * project placed by `buzz-channel` — resolves with its Folder from interop
 * itself since 0.61 (PEE-33, LTX-4), so the hook makes no read of its own.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const seam = vi.hoisted(() => ({
  resolveObject: vi.fn<(naddr: string) => Promise<ForeignObject | null>>(),
  // The copy on the device holds no file unless a case says so (PEE-4).
  resolveObjectFromDevice: vi.fn<(naddr: string) => Promise<ForeignObject | undefined>>(async () => undefined),
}))
vi.mock('@/api', () => ({ useForeignObjects: () => seam }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
// Desk's load ahead reads the relay itself (PEE-5): the relay answers an archived parent only when asked for it.
const ahead = vi.hoisted(() => ({ resolveObjectAsViewer: vi.fn() }))
vi.mock('@/nostr/foreign', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/nostr/foreign')>()),
  resolveObjectAsViewer: ahead.resolveObjectAsViewer,
}))

import { loadForeignObjectAhead, useForeignConversation } from './useForeignConversation'
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
    rerender({ naddr: PROJECT })
    expect(result.current.state).toBe('loading')
    expect(result.current.previous).toBe(issue)

    answer(foreign({ ref: PROJECT, address: PROJECT, kind: 30850 }))
    await waitFor(() => expect(result.current.state).toMatchObject({ address: PROJECT }))
    expect(result.current.previous).toBeNull()
  })
})

describe('loadForeignObjectAhead draws what the click would (PEE-5)', () => {
  it('an issue under an archived project, loaded ahead from Desk, opens still archived with its project', async () => {
    const issue = `30851:${SHIP}:5b0c4b0e-3b55-4d0c-9a51-0a4ead0a5c1e`
    const live = foreign({ ref: issue, address: issue, kind: 30851, folder: TEAM })
    const archived = foreign({ ref: issue, address: issue, kind: 30851, folder: TEAM, archive: { with: 'project' } } as never)
    ahead.resolveObjectAsViewer.mockImplementation(async (_a: string, _r: string, _t: unknown, opts?: { archivedWith?: boolean }) =>
      opts?.archivedWith ? archived : live,
    )
    await loadForeignObjectAhead(issue, { relayUrl: 'https://relay.test', token: {} as never })
    const { result } = renderHook(() => useForeignConversation(issue))
    expect(result.current.state).toBe(archived)
    expect(seam.resolveObject).not.toHaveBeenCalled()
  })
})
