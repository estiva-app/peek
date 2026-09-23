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
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<FileConversation>>(),
  comment: vi.fn<() => Promise<{ ok: true; id: string } | { ok: false; reason: string }>>(),
}))
vi.mock('@/nostr/fileConversation', () => ({
  conversationAsViewer: (container: unknown, rootIds: readonly string[]) => relay.read(container, rootIds),
  commentAsViewer: () => relay.comment(),
}))
// Stable across renders, as the real one is (`useCallback`): a fresh function
// per render would re-key `load` and loop the mount effect.
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'c'.repeat(64) } }))
vi.mock('./foreign', () => ({ useRelayViewer: () => viewer }))
/** The socket seam: which Folder was watched, and the listener to fire a fake 1111 through. */
const live = vi.hoisted(() => ({
  state: 'connecting' as 'connecting' | 'live',
  watched: [] as (string | null | undefined)[],
  kinds: undefined as readonly number[] | undefined,
  fire: undefined as (() => void) | undefined,
}))
vi.mock('@/nostr/useLiveFile', () => ({
  useLiveFile: (folder: string | null | undefined, onActivity: () => void, kinds?: readonly number[]) => {
    live.watched.push(folder)
    live.kinds = kinds
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
  edits: {},
} as unknown as FileConversation

beforeEach(() => {
  live.state = 'connecting'
  live.watched = []
  live.kinds = undefined
  live.fire = undefined
  refresh.options = undefined
  relay.read.mockResolvedValue(empty)
})
afterEach(() => {
  relay.read.mockReset()
  relay.comment.mockReset()
})

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

/*
  REM-1 — a DM is a channel container. It finds its own messages, so the read is
  asked for the channel and no roots; it watches the channel for its messages
  and what carries its `h`; and a new message, which only the channel read can
  find, is re-read here rather than left to a caller that has no object to
  re-resolve.
*/
describe('useFileConversation — a channel (REM-1)', () => {
  const CHANNEL = '22222222-2222-4222-8222-222222222222'
  const channel = { kind: 'channel' as const, h: CHANNEL }

  it('reads the channel, and watches it for messages, edits and resolutions', async () => {
    renderHook(() => useFileConversation(channel, []))
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(1))
    expect(relay.read).toHaveBeenCalledWith({ kind: 'channel', h: CHANNEL }, [])
    expect(live.watched[0]).toBe(CHANNEL)
    expect(live.kinds).toEqual([9, 40003, 9101])
  })

  it('a sent message is re-read from the relay once it has been accepted', async () => {
    relay.comment.mockResolvedValue({ ok: true, id: 'e'.repeat(64) })
    const { result } = renderHook(() => useFileConversation(channel, []))
    await waitFor(() => expect(result.current.state).toEqual(empty))
    let sent: unknown
    await act(async () => {
      sent = await result.current.actions.comment('hello')
    })
    expect(sent).toEqual({ ok: true, id: 'e'.repeat(64) })
    expect(relay.read).toHaveBeenCalledTimes(2)
  })

  it('a message the relay did not take is reported as not sent, and nothing is re-read', async () => {
    relay.comment.mockResolvedValue({ ok: false, reason: 'rate-limited: quota exceeded' })
    const { result } = renderHook(() => useFileConversation(channel, []))
    await waitFor(() => expect(result.current.state).toEqual(empty))
    let sent: unknown
    await act(async () => {
      sent = await result.current.actions.comment('hello')
    })
    expect(sent).toEqual({ ok: false, reason: 'rate-limited: quota exceeded' })
    expect(relay.read).toHaveBeenCalledTimes(1)
  })
})
