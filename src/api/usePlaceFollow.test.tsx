/**
 * The follow switch's own hook (TEA-6): what the header shows for a place, read
 * from the fake relay as a person would get it, and that a pick is read back
 * before the switch moves. The membership seam's own answers are covered by
 * `internal/membership.test.tsx`; here only its mutes and refresh are given.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Place } from '@estiva-app/conversation'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'

const sync = vi.hoisted(() => ({ muted: new Set<string>(), refresh: vi.fn(async () => {}) }))
vi.mock('@/nostr/useMembershipSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/nostr/useMembershipSync')>()),
  useMembershipSync: () => ({
    state: 'known',
    files: new Map(),
    changes: new Map(),
    mentioned: new Set<string>(),
    urgent: new Set<string>(),
    muted: sync.muted,
    floor: 0,
    setMember: async () => true,
    refresh: sync.refresh,
  }),
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2', expiresAt: Number.MAX_SAFE_INTEGER }),
}))
vi.mock('@/api/internal/openWork', () => ({ useOpenWork: () => ({}) }))
vi.mock('@/api/internal/screener', () => ({ useScreener: () => ({}) }))

import { MembershipProvider } from './internal/membership'
import { usePlaceFollow, type FollowTarget } from './usePlaceFollow'

const MIKY = 'a'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const D = 'd68a8c78-5ec7-4652-b236-89ab57ac5b1e'
const TOPIC = `30840:${MIKY}:${D}`
const T0 = 1_700_000_000

const place: Place = { address: TOPIC, team: TEAM }
const target: FollowTarget = { place, folder: TEAM, archived: false }
const root = signed({ kind: 30840, created_at: T0, tags: [['d', D], ['h', TEAM]] }, MIKY)
const level = (value: string) =>
  signed({ kind: 1851, created_at: T0 + 5, tags: [['a', TOPIC], ['field', `follow:${ME}`], ['value', value], ['h', TEAM], ['ts', String((T0 + 5) * 1000)], ['p', ME]] })

const wrapper = ({ children }: { children: ReactNode }) => <MembershipProvider>{children}</MembershipProvider>
const follow = () => renderHook(() => usePlaceFollow(target), { wrapper })

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  sync.muted = new Set()
  sync.refresh.mockClear()
})
afterAll(() => vi.unstubAllGlobals())

describe('usePlaceFollow — what the switch shows', () => {
  it('a topic they follow at All shows All, and lists them at All', async () => {
    relay.seed(root, level('all'))
    const { result } = follow()
    await waitFor(() => expect(result.current.state?.shown).toBe('all'))
    expect(result.current.listed?.find((l) => l.pubkey === ME)?.level).toBe('all')
    expect(result.current.failed).toBe(false)
  })

  it('a topic they follow at All but muted shows Not following', async () => {
    relay.seed(root, level('all'))
    sync.muted = new Set([TOPIC])
    const { result } = follow()
    await waitFor(() => expect(result.current.state).toBeDefined())
    expect(result.current.state?.shown).toBe('not-following')
  })

  it('a topic nobody follows shows Not following until a pick, then the pick once the relay holds it', async () => {
    relay.seed(root)
    const { result } = follow()
    await waitFor(() => expect(result.current.state?.shown).toBe('not-following'))

    await act(async () => {
      expect(await result.current.choose('important')).toEqual({ ok: true })
    })
    const [sent] = relay.sentOf(1851)
    expect([tagOf(sent, 'field'), tagOf(sent, 'value')]).toEqual([`follow:${ME}`, 'important'])
    expect(result.current.state?.shown).toBe('important')
    expect(result.current.listed?.find((l) => l.pubkey === ME)?.level).toBe('important')
    expect(sync.refresh).toHaveBeenCalled()
  })

  it('a refused pick leaves the switch where it was', async () => {
    relay.seed(root, level('all'))
    relay.refuse({ when: (event) => event.kind === 1851 })
    const { result } = follow()
    await waitFor(() => expect(result.current.state?.shown).toBe('all'))
    await act(async () => {
      expect((await result.current.choose('important')).ok).toBe(false)
    })
    expect(result.current.state?.shown).toBe('all')
  })
})
