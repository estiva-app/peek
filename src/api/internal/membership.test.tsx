/**
 * The seam's answers (CON-19): a file by its fold or its address, a Folder's own
 * chat as nobody's, mutes carried through, a mention counted by id.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

const sync = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))
vi.mock('@/nostr/useMembershipSync', () => ({ useMembershipSync: () => sync.value }))
const ME = 'c'.repeat(64)
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: ME }) }))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test' }))

import { MembershipProvider, useMembership } from './membership'

const THEIRS = `30851:${'d'.repeat(64)}:theirs`
const MINE = `30851:${ME}:mine`
const FOLDER = '11111111-1111-4111-8111-111111111111'

const seam = (over: Record<string, unknown> = {}) => {
  sync.value = {
    state: 'known',
    files: new Map(),
    mentioned: new Set<string>(),
    muted: new Set<string>(),
    floor: 100,
    setMember: async () => {},
    refresh: async () => {},
    ...over,
  }
  const wrapper = ({ children }: { children: ReactNode }) => <MembershipProvider>{children}</MembershipProvider>
  return renderHook(() => useMembership(), { wrapper }).result.current
}

describe('useMembership — what a judge is told', () => {
  it('a file folded as a member is one, since when it joined', () => {
    const m = seam({ files: new Map([[THEIRS, { member: true, since: 7 }]]) })
    expect(m.termsOf(THEIRS)).toEqual({ member: true, since: 7, muted: false })
    expect(m.isMember(THEIRS)).toBe(true)
    expect(m.memberFiles).toEqual([THEIRS])
  })

  it('a file the person created is theirs from the horizon, with no event read', () => {
    expect(seam().termsOf(MINE)).toEqual({ member: true, since: 100, muted: false })
  })

  it('a file the person created and left is not theirs', () => {
    const m = seam({ files: new Map([[MINE, { member: false }]]) })
    expect(m.termsOf(MINE)).toMatchObject({ member: false })
    expect(m.memberFiles).toEqual([])
  })

  it('a file the person has no part in is nobody’s dot', () => {
    expect(seam().termsOf(THEIRS)).toEqual({ member: false, muted: false })
  })

  it('a Folder’s own chat has no members: nothing to read in a Folder', () => {
    expect(seam().termsOf(FOLDER)).toEqual({ member: false, muted: false })
    expect(seam().isMember(FOLDER)).toBe(false)
  })

  it('carries a mute through to the judge', () => {
    const m = seam({ files: new Map([[THEIRS, { member: true, since: 7 }]]), muted: new Set([THEIRS]) })
    expect(m.termsOf(THEIRS)).toMatchObject({ member: true, muted: true })
  })

  it('counts a message that names the person by its id', () => {
    const m = seam({ mentioned: new Set(['named']) })
    expect(m.isMentioned('named')).toBe(true)
    expect(m.isMentioned('other')).toBe(false)
  })
})

describe('useMembership outside the provider', () => {
  it('is inert: unknown, nobody a member, controls that do nothing', async () => {
    const { result } = renderHook(() => useMembership())
    expect(result.current.state).toBe('unknown')
    expect(result.current.isMember(THEIRS)).toBe(false)
    // Nothing changed, and it says so: a toast reads false as "nothing changed".
    await expect(result.current.setMember(THEIRS, FOLDER, true)).resolves.toBe('Peek is not connected to the relay here.')
  })
})
