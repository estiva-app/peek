/**
 * Membership and mutes as one hook (CON-19, SPEC §11.8): two reads make one
 * answer, a join moves it at once and writes it, and a refused write puts it
 * back. The guards that stop a write made from a guess are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const relay = vi.hoisted(() => ({
  fetchMembership: vi.fn(),
  fetchMutes: vi.fn(),
  signViaEstivaId: vi.fn(),
  publishSigned: vi.fn(),
}))
// The copy on the device holds nothing here (PEE-2): only the relay's reads are counted.
vi.mock('./membership', () => ({
  fetchMembership: (...args: unknown[]) => (args[2] === 'copy' ? Promise.resolve(undefined) : relay.fetchMembership(...args)),
}))
vi.mock('./mutes', () => ({
  fetchMutes: (...args: unknown[]) => (args[1] === 'copy' ? Promise.resolve({ state: 'unreachable' }) : relay.fetchMutes(...args)),
}))
vi.mock('./bridge', () => ({ signViaEstivaId: relay.signViaEstivaId, publishSigned: relay.publishSigned }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'c'.repeat(64) }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))

import { useMembershipSync } from './useMembershipSync'

const ME = 'c'.repeat(64)
const FILE = `30851:${'b'.repeat(64)}:d4d3f511-f10f-4413-9123-fb3f9b00bc92`
const OTHER = `30840:${'b'.repeat(64)}:0a2e4f9b-2f1c-4a52-9c0f-5f0e9b0e1a11`
const FOLDER = '11111111-1111-4111-8111-111111111111'
const RELAY = 'https://relay.test'

const membershipRead = (files: [string, { member: boolean; since?: number }][] = []) => ({
  files: new Map(files),
  mentioned: new Set<string>(),
  floor: 1,
})

/** A read the test releases by hand, to hold `state` at `unknown`. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  relay.fetchMembership.mockResolvedValue(membershipRead([[FILE, { member: true, since: 5 }]]))
  relay.fetchMutes.mockResolvedValue({ state: 'present', keys: [OTHER] })
  relay.signViaEstivaId.mockImplementation(async (unsigned: object) => ({ ...unsigned, id: 'x', sig: 'y' }))
  relay.publishSigned.mockResolvedValue({ ok: true })
})
afterEach(() => {
  for (const mock of Object.values(relay)) mock.mockReset()
})

describe('useMembershipSync', () => {
  it('is unknown until both reads have landed', async () => {
    const pending = deferred<{ state: 'present'; keys: string[] }>()
    relay.fetchMutes.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(relay.fetchMembership).toHaveBeenCalledTimes(1))
    // The files alone do not settle it: a muted file lit for a moment is a wrong answer.
    expect(result.current.state).toBe('unknown')
    await act(async () => pending.resolve({ state: 'present', keys: [OTHER] }))
    await waitFor(() => expect(result.current.state).toBe('known'))
    expect(result.current.files.get(FILE)).toEqual({ member: true, since: 5 })
    expect([...result.current.muted]).toEqual([OTHER])
  })

  it('stays unknown while a read does not answer', async () => {
    relay.fetchMembership.mockResolvedValue(undefined)
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(relay.fetchMutes).toHaveBeenCalled())
    expect(result.current.state).toBe('unknown')
  })

  it('keeps what it held when a later read does not answer', async () => {
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('known'))
    relay.fetchMembership.mockResolvedValue(undefined)
    relay.fetchMutes.mockResolvedValue({ state: 'unreachable' })
    await act(() => result.current.refresh())
    expect(result.current.state).toBe('known')
    expect(result.current.files.get(FILE)?.member).toBe(true)
    expect([...result.current.muted]).toEqual([OTHER])
  })

  it('a join moves at once and publishes the person’s own member change, once', async () => {
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('known'))
    await act(() => result.current.setMember(OTHER, FOLDER, true))
    expect(result.current.files.get(OTHER)?.member).toBe(true)
    expect(relay.publishSigned).toHaveBeenCalledTimes(1)
    const unsigned = relay.signViaEstivaId.mock.calls[0][0]
    expect(unsigned.kind).toBe(1851)
    expect(unsigned.tags).toEqual(
      expect.arrayContaining([['a', OTHER], ['field', `member:${ME}`], ['value', 'true'], ['h', FOLDER], ['p', ME]]),
    )
  })

  it('adding somebody else signs a change naming them, and leaves the viewer’s own memberships alone (REA-3)', async () => {
    const ANA = 'a'.repeat(64)
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('known'))
    let outcome: true | string = ''
    await act(async () => {
      outcome = await result.current.setMember(OTHER, FOLDER, true, ANA)
    })
    expect(outcome).toBe(true)
    expect(relay.signViaEstivaId.mock.calls[0][0].tags).toEqual(
      expect.arrayContaining([['a', OTHER], ['field', `member:${ANA}`], ['value', 'true'], ['p', ANA]]),
    )
    expect(result.current.files.has(OTHER)).toBe(false)
    // A leave counts only when its person signs it (§11.8): never signed for somebody else.
    expect(await result.current.setMember(OTHER, FOLDER, false, ANA)).not.toBe(true)
    expect(relay.publishSigned).toHaveBeenCalledTimes(1)
  })

  it('a leave publishes member:false, and a refused one puts the membership back', async () => {
    relay.publishSigned.mockResolvedValue({ ok: false, reason: 'blocked' })
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('known'))
    await act(() => result.current.setMember(FILE, FOLDER, false))
    expect(relay.signViaEstivaId.mock.calls[0][0].tags).toEqual(expect.arrayContaining([['value', 'false']]))
    expect(result.current.files.get(FILE)).toEqual({ member: true, since: 5 })
  })

  it('refuses a join while membership is unknown, and one with no Folder to name', async () => {
    const pending = deferred<{ state: 'present'; keys: string[] }>()
    relay.fetchMutes.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(relay.fetchMembership).toHaveBeenCalled())
    await act(() => result.current.setMember(OTHER, FOLDER, true))
    expect(relay.publishSigned).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ state: 'present', keys: [] }))
    await waitFor(() => expect(result.current.state).toBe('known'))
    await act(() => result.current.setMember(OTHER, 'record-channel', true))
    expect(relay.publishSigned).not.toHaveBeenCalled()
    expect(result.current.files.has(OTHER)).toBe(false)
  })

  it('a read begun before a join was stored does not undo it, and one begun after is the relay’s word', async () => {
    const { result } = renderHook(() => useMembershipSync(RELAY))
    await waitFor(() => expect(result.current.state).toBe('known'))
    // The join is published but not yet stored when a read is begun and answered without it…
    const stored = deferred<{ ok: boolean }>()
    relay.publishSigned.mockReturnValue(stored.promise)
    let joining!: Promise<true | string>
    act(() => {
      joining = result.current.setMember(OTHER, FOLDER, true)
    })
    await waitFor(() => expect(relay.publishSigned).toHaveBeenCalled())
    await act(() => result.current.refresh())
    expect(result.current.files.get(OTHER)?.member).toBe(true)
    await act(async () => {
      stored.resolve({ ok: true })
      await joining
    })
    // …a read begun after the store is the relay's word, and the relay now holds it.
    relay.fetchMembership.mockResolvedValue(membershipRead([[OTHER, { member: true, since: 9 }]]))
    // Strictly later than the store, as a read begun in the same millisecond cannot be told apart from it.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await act(() => result.current.refresh())
    expect(result.current.files.get(OTHER)).toEqual({ member: true, since: 9 })
  })
})
