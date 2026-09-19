import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FileConversation } from '@/nostr/fileConversation'

/*
  FOL-32 — the hook's live half. The read itself is `fileConversation.test.ts`'s;
  what is pinned here is the contract with the socket: the container's Folder
  is what gets watched, a fake 1111 there re-reads the conversation and tells
  the caller to re-resolve the object, and the interval idles while the socket
  is live and returns when it is not.
*/
const relay = vi.hoisted(() => ({
  read: vi.fn<() => Promise<FileConversation>>(),
}))
vi.mock('@/nostr/fileConversation', () => ({
  fileConversationAsViewer: () => relay.read(),
}))
// Stable across renders, as the real one is (`useCallback`): a fresh function
// per render would re-key `load` and loop the mount effect.
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'c'.repeat(64) } }))
vi.mock('./foreign', () => ({ useRelayViewer: () => viewer }))
/** The socket seam: which Folder was watched, and the listener to fire a fake 1111 through. */
const live = vi.hoisted(() => ({
  state: 'connecting' as 'connecting' | 'live',
  watched: [] as (string | null | undefined)[],
  fire: undefined as (() => void) | undefined,
}))
vi.mock('@/nostr/useLiveFile', () => ({
  useLiveFile: (folder: string | null | undefined, onActivity: () => void) => {
    live.watched.push(folder)
    live.fire = onActivity
    return { relayState: live.state }
  },
}))
/** Captured so a test can read what the fallback was told. */
const refresh = vi.hoisted(() => ({ options: undefined as { enabled?: boolean; interval?: boolean } | undefined }))
vi.mock('@/lib/useRefreshTriggers', () => ({
  useRefreshTriggers: (_fn: () => void, opts?: { enabled?: boolean; interval?: boolean }) => {
    refresh.options = opts
  },
}))

import { useFileConversation } from './useFileConversation'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const container = { kind: 'file' as const, address: '30850:abc:d', h: FOLDER }
const empty: FileConversation = {
  roots: [],
  replies: {},
  decorations: { byId: {}, reactionTargetsOmitted: 0 },
} as unknown as FileConversation

beforeEach(() => {
  live.state = 'connecting'
  live.watched = []
  live.fire = undefined
  refresh.options = undefined
  relay.read.mockResolvedValue(empty)
})
afterEach(() => relay.read.mockReset())

describe('useFileConversation — live (FOL-32)', () => {
  it('watches the container’s Folder', async () => {
    renderHook(() => useFileConversation(container, ['r1']))
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(1))
    expect(live.watched[0]).toBe(FOLDER)
  })

  it('a fake 1111 on the Folder re-reads the conversation and re-resolves the object', async () => {
    const onActivity = vi.fn()
    const { result } = renderHook(() => useFileConversation(container, ['r1'], { onActivity }))
    await waitFor(() => expect(result.current.state).toEqual(empty))
    expect(relay.read).toHaveBeenCalledTimes(1)
    await act(async () => {
      live.fire?.()
    })
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(2))
    expect(onActivity).toHaveBeenCalledTimes(1)
  })

  it('the interval idles under a live socket and is back when it is not', () => {
    live.state = 'live'
    const { rerender } = renderHook(() => useFileConversation(container, ['r1']))
    expect(refresh.options).toEqual({ enabled: true, interval: false })
    live.state = 'connecting'
    rerender()
    expect(refresh.options).toEqual({ enabled: true, interval: true })
  })
})
