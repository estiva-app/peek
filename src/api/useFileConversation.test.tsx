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
  SID-1 — a new root is a re-read of the same conversation, not a new one. The
  answer is keyed on the container, so the list stays on screen while the read
  that includes the new root is out; only a different container starts again
  from 'loading'.
*/
describe('useFileConversation — a new root keeps the conversation (SID-1)', () => {
  const withRoot = (id: string) => ({ ...empty, roots: [{ id }] }) as unknown as FileConversation
  const one = withRoot('r1')
  const two = { ...empty, roots: [{ id: 'r1' }, { id: 'r2' }] } as unknown as FileConversation

  /** Every state the hook rendered, so a single 'loading' frame cannot hide. */
  function mount(initial: { container: typeof container; rootIds: string[] }) {
    const seen: unknown[] = []
    const hook = renderHook(
      ({ container: c, rootIds }) => {
        const out = useFileConversation(c, rootIds)
        seen.push(out.state)
        return out
      },
      { initialProps: initial },
    )
    return { ...hook, seen }
  }

  it('a new root re-reads with it, and the state never drops back to loading', async () => {
    relay.read.mockResolvedValueOnce(one)
    const { result, rerender, seen } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))

    let land!: (c: FileConversation) => void
    relay.read.mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
    const from = seen.length
    rerender({ container, rootIds: ['r1', 'r2'] })
    expect(relay.read).toHaveBeenLastCalledWith(container, ['r1', 'r2'])
    // While the read is out, the conversation it had is what is drawn.
    expect(result.current.state).toBe(one)
    await act(async () => land(two))
    expect(result.current.state).toBe(two)
    expect(seen.slice(from)).not.toContain('loading')
    expect(relay.read).toHaveBeenCalledTimes(2)
  })

  it('a failed re-read keeps the conversation it has (FOL-40)', async () => {
    relay.read.mockResolvedValueOnce(one)
    const { result, rerender } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))
    relay.read.mockRejectedValueOnce(new Error('rate-limited: slow down'))
    rerender({ container, rootIds: ['r1', 'r2'] })
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(result.current.state).toBe(one)
  })

  it('a first read still reports its failure', async () => {
    relay.read.mockRejectedValueOnce(new Error('rate-limited: slow down'))
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toEqual({ failed: 'rate_limited' }))
  })

  it('a live re-read with the old roots does not paint over the read with the new one', async () => {
    relay.read.mockResolvedValueOnce(one)
    const { result, rerender } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))

    // The signal fires: this hook re-reads with the roots it has, while the
    // caller's re-resolve finds r2 and the ids change under it.
    let stale!: (c: FileConversation) => void
    relay.read.mockReturnValueOnce(new Promise((resolve) => (stale = resolve)))
    await act(async () => live.fire?.())
    relay.read.mockResolvedValueOnce(two)
    rerender({ container, rootIds: ['r1', 'r2'] })
    await waitFor(() => expect(result.current.state).toBe(two))
    await act(async () => stale(one))
    expect(result.current.state).toBe(two)
  })

  it('negative control: a different container starts from loading', async () => {
    relay.read.mockResolvedValueOnce(one)
    const { result, rerender } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))
    relay.read.mockReturnValueOnce(new Promise(() => {}))
    rerender({ container: { ...container, address: '30850:abc:other' }, rootIds: ['r9'] })
    expect(result.current.state).toBe('loading')
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
