import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/*
  What a file's Members dialog asks the relay for (ALO-19): its changes naming
  anyone with a profile, and every change when the profiles are unknown or
  none came back, rather than miss somebody. The relay is stubbed at
  `queryRelay` and the directory at `workspaceKeys`; what is asserted is the
  filter that goes on the wire.
*/
const ME = 'c'.repeat(64)
const KAT = 'd'.repeat(64)
const FILE = `30851:${'e'.repeat(64)}:6bd072cb-6c30-4883-abb5-faf880d0c444`

const keys = vi.hoisted(() => ({ value: undefined as string[] | undefined }))
const queryRelay = vi.hoisted(() => vi.fn(async (_url: string, _filters: Record<string, unknown>[]) => ({ ok: true, events: [] })))
vi.mock('@/api/foreign', () => ({ workspaceKeys: async () => keys.value }))
vi.mock('@/nostr/bridge', () => ({ queryRelay }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'c'.repeat(64), accessToken: 't' }) }))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test' }))
vi.mock('@/api/conversations', () => ({ isConversationHeld: () => false, onFileNews: () => () => {} }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))

import { useFileMembers } from './fileMembers'

const changeFilter = () => queryRelay.mock.calls[0]?.[1].find((f) => (f.kinds as number[]).includes(1851))

beforeEach(() => queryRelay.mockClear())

describe("a file's Members dialog, as it asks the relay (ALO-19)", () => {
  it('asks for the changes naming anyone with a profile, and the viewer', async () => {
    keys.value = [KAT]
    renderHook(() => useFileMembers(FILE))
    await waitFor(() => expect(queryRelay).toHaveBeenCalled())
    expect(changeFilter()).toEqual({ kinds: [1851], '#a': [FILE], '#p': [ME, KAT].sort() })
  })

  it('asks for every change when the profiles could not be read', async () => {
    keys.value = undefined
    renderHook(() => useFileMembers(FILE))
    await waitFor(() => expect(queryRelay).toHaveBeenCalled())
    expect(changeFilter()).toEqual({ kinds: [1851], '#a': [FILE] })
  })

  it('asks for every change when the directory came back empty, not for the viewer alone', async () => {
    keys.value = []
    renderHook(() => useFileMembers(FILE))
    await waitFor(() => expect(queryRelay).toHaveBeenCalled())
    expect(changeFilter()).toEqual({ kinds: [1851], '#a': [FILE] })
  })
})
