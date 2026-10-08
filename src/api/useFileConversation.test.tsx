import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FileConversation } from '@/nostr/fileConversation'
import type { ConversationStore } from '@/platform/conversationStore'
import { RelayReadError } from '@/nostr/relayRead'

/*
  The hook's contract with the held store (OPT-3) and the socket (FOL-32). The
  reads themselves are `conversationCatchUp.test.ts`'s and
  `fileConversation.test.ts`'s; what is pinned here is when each runs: the first
  open reads the conversation, everything after — a live signal, a new root, a
  write, a return — catches up, and a return draws what is held on its first
  frame.
*/
type CatchUp = (
  store: ConversationStore<FileConversation>,
  key: string,
  container: unknown,
  rootIds: readonly string[],
) => Promise<{ changed: boolean; object: boolean; mentions: boolean }>
const relay = vi.hoisted(() => ({
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<{ value: FileConversation; events: [] }>>(),
  catchUp: vi.fn<CatchUp>(),
  comment: vi.fn<() => Promise<{ ok: true; id: string } | { ok: false; reason: string }>>(),
}))
vi.mock('@/nostr/conversationCatchUp', () => ({
  readConversation: (container: unknown, rootIds: readonly string[]) => relay.read(container, rootIds),
  catchUpConversation: (store: ConversationStore<FileConversation>, key: string, container: unknown, rootIds: readonly string[]) =>
    relay.catchUp(store, key, container, rootIds),
}))
vi.mock('@/nostr/fileConversation', () => ({ commentAsViewer: () => relay.comment() }))
vi.mock('@/nostr/foreign', () => ({ viewerQuery: () => async () => [] }))
// Stable across renders, as the real one is (`useCallback`).
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
const refresh = vi.hoisted(() => ({ options: undefined as { enabled?: boolean; interval?: boolean } | undefined }))
vi.mock('@/lib/useRefreshTriggers', () => ({
  useRefreshTriggers: (_fn: () => void, opts?: { enabled?: boolean; interval?: boolean }) => {
    refresh.options = opts
  },
}))

import { useFileConversation } from './useFileConversation'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const container = { kind: 'file' as const, address: '30850:abc:d', h: FOLDER }
const empty = { roots: [], replies: {}, decorations: { byId: {}, reactionTargetsOmitted: 0 } } as unknown as FileConversation
const withRoots = (...ids: string[]) => ({ ...empty, roots: ids.map((id) => ({ id })) }) as unknown as FileConversation
const one = withRoots('r1')
const two = withRoots('r1', 'r2')

/** A catch-up that found `value`: the store folds it in, as the real one does. */
const finds = (value: FileConversation, object = false) =>
  (async (store, key) => {
    store.settle(key, Date.now(), value)
    return { changed: true, object, mentions: false }
  }) satisfies CatchUp

beforeEach(() => {
  live.state = 'connecting'
  live.watched = []
  live.kinds = undefined
  live.fire = undefined
  refresh.options = undefined
  relay.read.mockResolvedValue({ value: empty, events: [] })
  relay.catchUp.mockResolvedValue({ changed: false, object: false, mentions: false })
})
afterEach(() => {
  relay.read.mockReset()
  relay.catchUp.mockReset()
  relay.comment.mockReset()
})

/** Every state the hook rendered, so a single 'loading' frame cannot hide. */
function mount(initial: { container: typeof container | { kind: 'channel'; h: string }; rootIds: string[] }, onActivity?: () => void) {
  const seen: unknown[] = []
  const hook = renderHook(
    ({ container: c, rootIds }) => {
      const out = useFileConversation(c, rootIds, { onActivity })
      seen.push(out.state)
      return out
    },
    { initialProps: initial },
  )
  return { ...hook, seen }
}

describe('useFileConversation — live (FOL-32)', () => {
  it('watches the container’s Folder', async () => {
    mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(1))
    expect(live.watched[0]).toBe(FOLDER)
  })

  it('a fake 1111 on the Folder catches up, and re-resolves the object only when the file changed', async () => {
    const onActivity = vi.fn()
    const { result } = mount({ container, rootIds: ['r1'] }, onActivity)
    await waitFor(() => expect(result.current.state).toBe(empty))
    await act(async () => live.fire?.())
    expect(relay.catchUp).toHaveBeenCalledTimes(1)
    expect(relay.read).toHaveBeenCalledTimes(1)
    expect(onActivity).not.toHaveBeenCalled()

    relay.catchUp.mockImplementationOnce(finds(one, true))
    await act(async () => live.fire?.())
    expect(result.current.state).toBe(one)
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

describe('useFileConversation — held (OPT-3)', () => {
  it('a return draws what is held on its first frame, and only catches up', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
    const first = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(first.result.current.state).toBe(one))
    first.unmount()

    const back = mount({ container, rootIds: ['r1'] })
    expect(back.seen[0]).toBe(one)
    expect(back.seen).not.toContain('loading')
    await waitFor(() => expect(relay.catchUp).toHaveBeenCalledTimes(1))
    expect(relay.read).toHaveBeenCalledTimes(1)
  })

  it('what the catch-up found is drawn without a placeholder in between', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
    const first = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(first.result.current.state).toBe(one))
    first.unmount()

    relay.catchUp.mockImplementationOnce(finds(two))
    const back = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(back.result.current.state).toBe(two))
    expect(back.seen).not.toContain('loading')
  })

  it('losing access drops what was held and says so', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))
    relay.catchUp.mockRejectedValueOnce(new RelayReadError('relay_membership_required'))
    await act(async () => live.fire?.())
    await waitFor(() => expect(result.current.state).toEqual({ failed: 'not_a_member' }))
  })
})

/*
  SID-1 — a new root is the same conversation, not a new one: the list stays on
  screen while the catch-up that brings it is out.
*/
describe('useFileConversation — a new root keeps the conversation (SID-1)', () => {
  it('a new root catches up with it, and the state never drops back to loading', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
    const { result, rerender, seen } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))

    let land!: () => void
    relay.catchUp.mockImplementationOnce(async (store, key) => {
      await new Promise<void>((resolve) => (land = resolve))
      store.settle(key, Date.now(), two)
      return { changed: true, object: false, mentions: false }
    })
    const from = seen.length
    rerender({ container, rootIds: ['r1', 'r2'] })
    await waitFor(() => expect(relay.catchUp).toHaveBeenCalledTimes(1))
    expect(relay.catchUp.mock.calls[0][3]).toEqual(['r1', 'r2'])
    expect(result.current.state).toBe(one)
    await act(async () => land())
    expect(result.current.state).toBe(two)
    expect(seen.slice(from)).not.toContain('loading')
    expect(relay.read).toHaveBeenCalledTimes(1)
  })

  it('a failed catch-up keeps the conversation it has (FOL-40)', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
    const { result, rerender } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))
    relay.catchUp.mockRejectedValueOnce(new Error('rate-limited: slow down'))
    rerender({ container, rootIds: ['r1', 'r2'] })
    await waitFor(() => expect(relay.catchUp).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(result.current.state).toBe(one)
  })

  it('a first read still reports its failure', async () => {
    relay.read.mockRejectedValueOnce(new Error('rate-limited: slow down'))
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toEqual({ failed: 'rate_limited' }))
  })

  it('signals while one catch-up is out are folded into one more, with the latest roots', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
    const { result, rerender } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))

    let land!: () => void
    relay.catchUp.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (land = resolve))
      return { changed: false, object: false, mentions: false }
    })
    await act(async () => live.fire?.())
    await act(async () => live.fire?.())
    rerender({ container, rootIds: ['r1', 'r2'] })
    await act(async () => land())
    await waitFor(() => expect(relay.catchUp).toHaveBeenCalledTimes(2))
    expect(relay.catchUp.mock.calls[1][3]).toEqual(['r1', 'r2'])
  })

  it('negative control: a different container starts from loading', async () => {
    relay.read.mockResolvedValueOnce({ value: one, events: [] })
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
  and what carries its `h`; and a new message is caught up here.
*/
describe('useFileConversation — a channel (REM-1)', () => {
  const CHANNEL = '22222222-2222-4222-8222-222222222222'
  const channel = { kind: 'channel' as const, h: CHANNEL }

  it('reads the channel, and watches it for messages, edits and resolutions', async () => {
    mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(1))
    expect(relay.read).toHaveBeenCalledWith({ kind: 'channel', h: CHANNEL }, [])
    expect(live.watched[0]).toBe(CHANNEL)
    expect(live.kinds).toEqual([9, 40003, 9101])
  })

  it('a sent message is caught up once the relay has accepted it', async () => {
    relay.comment.mockResolvedValue({ ok: true, id: 'e'.repeat(64) })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let sent: unknown
    await act(async () => {
      sent = await result.current.actions.comment('hello')
    })
    expect(sent).toEqual({ ok: true, id: 'e'.repeat(64) })
    expect(relay.catchUp).toHaveBeenCalledTimes(1)
  })

  it('a message the relay did not take is reported as not sent, and nothing is asked', async () => {
    relay.comment.mockResolvedValue({ ok: false, reason: 'rate-limited: quota exceeded' })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let sent: unknown
    await act(async () => {
      sent = await result.current.actions.comment('hello')
    })
    expect(sent).toEqual({ ok: false, reason: 'rate-limited: quota exceeded' })
    expect(relay.catchUp).not.toHaveBeenCalled()
  })
})
