import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { FileConversation } from '@/nostr/fileConversation'
import type { ConversationStore } from '@/platform/conversationStore'
import { RelayReadError } from '@/nostr/relayRead'
import type { SignedEvent } from '@estiva-app/protocol'

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
type Apply = (...args: [...Parameters<CatchUp>, events: readonly SignedEvent[]]) => ReturnType<CatchUp>
const relay = vi.hoisted(() => ({
  read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<{ value: FileConversation; events: [] }>>(),
  catchUp: vi.fn<CatchUp>(),
  apply: vi.fn<Apply>(),
  publish: vi.fn<() => Promise<{ ok: true; id: string } | { ok: false; reason: string }>>(),
  react: vi.fn<() => Promise<{ ok: true; id: string } | { ok: false; reason: string }>>(),
  /** A resolution's write: it is not drawn ahead, so the conversation is re-read once the relay has taken it. */
  resolve: vi.fn<() => Promise<{ ok: true; id: string } | { ok: false; reason: string }>>(),
  /** What happened to your own events, in order (OPT-6). */
  own: [] as string[],
  composed: 0,
}))
/** The same read against the copy on the device (PEE-4): holds nothing unless a case says so. */
const copy = vi.hoisted(() => ({ read: vi.fn<(container: unknown, rootIds: readonly string[]) => Promise<FileConversation>>() }))
vi.mock('@/nostr/conversationFromCopy', () => ({
  conversationFromCopy: (container: unknown, rootIds: readonly string[]) => copy.read(container, rootIds),
}))
vi.mock('@/nostr/conversationCatchUp', () => ({
  readConversation: (container: unknown, rootIds: readonly string[]) => relay.read(container, rootIds),
  catchUpConversation: (store: ConversationStore<FileConversation>, key: string, container: unknown, rootIds: readonly string[]) =>
    relay.catchUp(store, key, container, rootIds),
  applyLiveEvents: (store: ConversationStore<FileConversation>, key: string, container: unknown, rootIds: readonly string[], events: readonly SignedEvent[]) =>
    relay.apply(store, key, container, rootIds, events),
  showOwnEvent: async (_store: unknown, _key: string, _container: unknown, _roots: unknown, event: SignedEvent) => {
    relay.own.push(`shown ${event.id}`)
    return true
  },
  confirmOwnEvent: (id: string) => relay.own.push(`confirmed ${id}`),
  withdrawOwnEvent: async (_store: unknown, _key: string, _container: unknown, _roots: unknown, id: string) => {
    relay.own.push(`withdrawn ${id}`)
  },
}))
/** Each composed event's id is `<n>` repeated: the first message is '1'×64. */
const idOf = (n: number) => String(n).repeat(64)
vi.mock('@/nostr/fileConversation', () => ({
  composeCommentAsViewer: async (args: { body: string }) => {
    relay.composed += 1
    return { ok: true, event: { kind: 9, content: args.body, tags: [], created_at: relay.composed, pubkey: 'c'.repeat(64) } }
  },
  eventIdOf: async (event: { created_at: number }) => idOf(event.created_at),
  publishConfirmed: () => relay.publish(),
  // A reaction, an edit and a delete are built the same way (OPT-8): counted with the messages, so ids stay in order.
  composeReaction: (args: { emoji: string }) => {
    relay.react()
    relay.composed += 1
    return { kind: 7, content: args.emoji, tags: [], created_at: relay.composed, pubkey: 'c'.repeat(64) }
  },
  composeEdit: (args: { body: string }) => {
    relay.composed += 1
    return { kind: 40003, content: args.body, tags: [], created_at: relay.composed, pubkey: 'c'.repeat(64) }
  },
  composeDeletion: () => {
    relay.composed += 1
    return { kind: 5, content: '', tags: [], created_at: relay.composed, pubkey: 'c'.repeat(64) }
  },
  resolveAsViewer: () => relay.resolve(),
}))
vi.mock('@/nostr/foreign', () => ({ viewerQuery: () => async () => [] }))
// Stable across renders, as the real one is (`useCallback`).
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'c'.repeat(64) } }))
vi.mock('./foreign', () => ({ useRelayViewer: () => viewer }))
/** The socket seam: which Folder was watched, and the listener to fire a fake 1111 through. */
const live = vi.hoisted(() => ({
  state: 'connecting' as 'connecting' | 'live',
  watched: [] as (string | null | undefined)[],
  kinds: undefined as readonly number[] | undefined,
  fire: undefined as ((event?: SignedEvent) => void) | undefined,
}))
vi.mock('@/nostr/useLiveFile', () => ({
  useLiveFile: (folder: string | null | undefined, onActivity: (event?: SignedEvent) => void, kinds?: readonly number[]) => {
    live.watched.push(folder)
    live.kinds = kinds
    live.fire = onActivity
    return { relayState: live.state }
  },
}))
const refresh = vi.hoisted(() => ({ options: undefined as { enabled?: boolean; intervalMs?: number } | undefined }))
vi.mock('@/lib/useRefreshTriggers', () => ({
  REFRESH_INTERVAL_MS: 30_000,
  useRefreshTriggers: (_fn: () => void, opts?: { enabled?: boolean; intervalMs?: number }) => {
    refresh.options = opts
  },
}))

import { useFileConversation } from './useFileConversation'
import { conversationKey, conversationsFor } from './conversations'

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
  copy.read.mockReset().mockRejectedValue(new Error('not in the copy on this device'))
})
afterEach(() => {
  relay.read.mockReset()
  relay.catchUp.mockReset()
  relay.apply.mockReset()
  relay.publish.mockReset()
  relay.react.mockReset()
  relay.resolve.mockReset()
  relay.own = []
  relay.composed = 0
})

const event = (id: string) => ({ id, kind: 1111, tags: [['h', FOLDER]] }) as unknown as SignedEvent

/** Every state the hook rendered, so a single 'loading' frame cannot hide. */
function mount(initial: { container: typeof container | { kind: 'channel'; h: string }; rootIds: string[] | null }, onActivity?: () => void) {
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

  it('an event from the socket is applied, with no read and no catch-up (OPT-5)', async () => {
    const onActivity = vi.fn()
    const { result } = mount({ container, rootIds: ['r1'] }, onActivity)
    await waitFor(() => expect(result.current.state).toBe(empty))
    relay.apply.mockImplementationOnce(finds(one))
    await act(async () => live.fire?.(event('e1')))
    expect(relay.apply).toHaveBeenCalledTimes(1)
    expect(relay.apply.mock.calls[0][4]).toEqual([event('e1')])
    expect(result.current.state).toBe(one)
    expect(relay.catchUp).not.toHaveBeenCalled()
    expect(relay.read).toHaveBeenCalledTimes(1)
    expect(onActivity).not.toHaveBeenCalled()

    // The file itself changed (a field): the object is re-resolved.
    relay.apply.mockImplementationOnce(finds(one, true))
    await act(async () => live.fire?.(event('e2')))
    expect(onActivity).toHaveBeenCalledTimes(1)
  })

  it('events that arrive while one is applied are applied together after it', async () => {
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let release = () => {}
    relay.apply.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ changed: false, object: false, mentions: false }))))
    await act(async () => {
      live.fire?.(event('e1'))
      live.fire?.(event('e2'))
      live.fire?.(event('e3'))
      release()
    })
    await waitFor(() => expect(relay.apply).toHaveBeenCalledTimes(2))
    expect(relay.apply.mock.calls.map((call) => call[4].map((e) => e.id))).toEqual([['e1'], ['e2', 'e3']])
  })

  it('no event — the socket came back — catches up, and re-resolves the object only when the file changed', async () => {
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

  it('catches up once a minute under a live socket — for reactions and deletions — and every 30 s when not', () => {
    live.state = 'live'
    const { rerender } = renderHook(() => useFileConversation(container, ['r1']))
    expect(refresh.options).toEqual({ enabled: true, intervalMs: 60_000 })
    live.state = 'connecting'
    rerender()
    expect(refresh.options).toEqual({ enabled: true, intervalMs: 30_000 })
  })
})

describe('useFileConversation — before the file resolves (OPT-9)', () => {
  it('reads nothing while the roots are not known, then reads once with them', async () => {
    const { result, rerender, seen } = mount({ container, rootIds: null })
    await act(async () => live.fire?.(event('e1')))
    expect(relay.read).not.toHaveBeenCalled()
    expect(relay.apply).not.toHaveBeenCalled()
    expect(seen.every((state) => state === 'loading')).toBe(true)

    rerender({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    expect(relay.read).toHaveBeenCalledTimes(1)
    expect(relay.read.mock.calls[0][1]).toEqual(['r1'])
  })

  it('a comment sent before the roots are known is asked for by the first read', async () => {
    relay.publish.mockResolvedValue({ ok: true, id: '1'.repeat(64) })
    const { result, rerender } = mount({ container, rootIds: null })
    await act(async () => {
      await result.current.actions.comment('Sent early')
    })
    expect(relay.read).not.toHaveBeenCalled()

    rerender({ container, rootIds: ['r1'] })
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(1))
    expect(relay.read.mock.calls[0][1]).toEqual(['r1', '1'.repeat(64)])
  })

  it('a comment drawn while the first read is out stays when that read lands without it', async () => {
    /*
      The first read began before the comment was sent, so its answer does not
      have it. The conversation was held meanwhile with the comment drawn in it
      (a topic just started holds its conversation, PEE-6): that is newer than
      the read, which must not land over it.
    */
    const fresh = { ...container, address: '30850:abc:first-read' }
    let land!: (answer: { value: FileConversation; events: [] }) => void
    relay.read.mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
    const { result } = mount({ container: fresh, rootIds: ['r1'] })
    await waitFor(() => expect(relay.read).toHaveBeenCalledTimes(1))

    const drawn = withRoots('r1', idOf(1))
    act(() => conversationsFor('https://relay.test', 'c'.repeat(64)).replace(conversationKey(fresh), drawn, [], Date.now()))
    expect(result.current.state).toBe(drawn)

    await act(async () => land({ value: one, events: [] }))
    expect(result.current.state).toBe(drawn)
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

  it('the copy on the device draws a first open until the relay answers, and only the relay’s is held (PEE-4)', async () => {
    let answer: () => void = () => {}
    relay.read.mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve({ value: two, events: [] }))))
    copy.read.mockResolvedValueOnce(one)
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))
    await act(async () => answer())
    expect(result.current.state).toBe(two)
    expect(relay.read).toHaveBeenCalledTimes(1)
  })

  it('a first read that fails keeps the copy’s conversation — unless the Folder is no longer the viewer’s', async () => {
    relay.read.mockRejectedValueOnce(new Error('rate-limited: slow down'))
    copy.read.mockResolvedValueOnce(one)
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(one))
    await act(async () => {})
    expect(result.current.state).toBe(one)

    relay.read.mockRejectedValueOnce(new RelayReadError('relay_membership_required'))
    copy.read.mockResolvedValueOnce(one)
    const lost = mount({ container: { kind: 'channel', h: 'gone' }, rootIds: [] })
    await waitFor(() => expect(lost.result.current.state).toEqual({ failed: 'not_a_member' }))
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
    expect(live.kinds).toEqual([9, 40003, 9101, 9005])
  })

  /** A publish that answers when told to. */
  const pending = () => {
    let answer!: (result: { ok: true; id: string } | { ok: false; reason: string }) => void
    relay.publish.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    return (result: Parameters<typeof answer>[0]) => act(async () => answer(result))
  }

  it('a sent message is drawn before the relay answers, under the id it will have, and nothing is read after it (OPT-6)', async () => {
    const answer = pending()
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let sent: Promise<unknown> = Promise.resolve()
    await act(async () => {
      sent = result.current.actions.comment('hello')
    })
    expect(relay.own).toEqual([`shown ${idOf(1)}`])
    await answer({ ok: true, id: idOf(1) })
    expect(await sent).toEqual({ ok: true, id: idOf(1) })
    expect(relay.own).toEqual([`shown ${idOf(1)}`, `confirmed ${idOf(1)}`])
    expect(relay.catchUp).not.toHaveBeenCalled()
    expect(relay.read).toHaveBeenCalledTimes(1)
  })

  it('a message the relay did not take is taken out again and reported as not sent, and nothing is asked', async () => {
    relay.publish.mockResolvedValue({ ok: false, reason: 'rate-limited: quota exceeded' })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let sent: unknown
    await act(async () => {
      sent = await result.current.actions.comment('hello')
    })
    expect(sent).toEqual({ ok: false, reason: 'rate-limited: quota exceeded' })
    expect(relay.own).toEqual([`shown ${idOf(1)}`, `withdrawn ${idOf(1)}`])
    expect(relay.catchUp).not.toHaveBeenCalled()
  })

  it('negative control: signed as something other than what was drawn, the drawn one goes and a catch-up finds the real one', async () => {
    relay.publish.mockResolvedValue({ ok: true, id: 'f'.repeat(64) })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    await act(async () => {
      await result.current.actions.comment('hello')
    })
    expect(relay.own).toEqual([`shown ${idOf(1)}`, `withdrawn ${idOf(1)}`])
    await waitFor(() => expect(relay.catchUp).toHaveBeenCalledTimes(1))
  })

  it('a reply to, or a reaction on, a message still being sent waits for it — and is refused with it (Miky, 7 Oct)', async () => {
    const answer = pending()
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let reply: Promise<unknown> = Promise.resolve()
    let reaction: Promise<unknown> = Promise.resolve()
    await act(async () => {
      void result.current.actions.comment('hello')
    })
    await act(async () => {
      reply = result.current.actions.reply({ id: idOf(1) } as never, 'and more')
      reaction = result.current.actions.react(idOf(1), '👍')
    })
    // Neither is built nor sent while the message is out.
    expect(relay.composed).toBe(1)
    expect(relay.react).not.toHaveBeenCalled()
    await answer({ ok: false, reason: 'blocked' })
    const refused = { ok: false, reason: 'Your earlier message was not sent, so this was not either.' }
    expect(await reply).toEqual(refused)
    expect(await reaction).toEqual(refused)
    expect(relay.composed).toBe(1)
    expect(relay.react).not.toHaveBeenCalled()
  })

  it('a reaction, an edit and a delete are each drawn before the relay answers, and nothing is read after (OPT-8)', async () => {
    relay.publish.mockResolvedValue({ ok: true, id: '' })
    relay.publish
      .mockResolvedValueOnce({ ok: true, id: idOf(1) })
      .mockResolvedValueOnce({ ok: true, id: idOf(2) })
      .mockResolvedValueOnce({ ok: true, id: idOf(3) })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    const target = 'e'.repeat(64)
    await act(async () => {
      expect(await result.current.actions.react(target, '👍')).toEqual({ ok: true, id: idOf(1) })
      expect(await result.current.actions.edit(target, 'new text')).toEqual({ ok: true, id: idOf(2) })
      expect(await result.current.actions.remove(target)).toEqual({ ok: true, id: idOf(3) })
    })
    expect(relay.own).toEqual([1, 2, 3].flatMap((n) => [`shown ${idOf(n)}`, `confirmed ${idOf(n)}`]))
    expect(relay.catchUp).not.toHaveBeenCalled()
    expect(relay.read).toHaveBeenCalledTimes(1)
  })

  it('a reaction, an edit or a delete the relay refused is taken out again, and the refusal reported (OPT-8)', async () => {
    relay.publish.mockResolvedValue({ ok: false, reason: 'invalid: event id does not match' })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    const target = 'e'.repeat(64)
    const refused = { ok: false, reason: 'invalid: event id does not match' }
    await act(async () => {
      expect(await result.current.actions.react(target, '👍')).toEqual(refused)
      expect(await result.current.actions.edit(target, 'new text')).toEqual(refused)
      expect(await result.current.actions.remove(target)).toEqual(refused)
    })
    expect(relay.own).toEqual([1, 2, 3].flatMap((n) => [`shown ${idOf(n)}`, `withdrawn ${idOf(n)}`]))
    expect(relay.catchUp).not.toHaveBeenCalled()
  })

  it('taking back a reaction still being sent waits for it (OPT-8)', async () => {
    const answer = pending()
    relay.publish.mockResolvedValueOnce({ ok: true, id: idOf(2) })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let taken: Promise<unknown> = Promise.resolve()
    await act(async () => {
      void result.current.actions.react('e'.repeat(64), '👍')
    })
    await act(async () => {
      taken = result.current.actions.remove(idOf(1))
    })
    expect(relay.composed).toBe(1)
    await answer({ ok: true, id: idOf(1) })
    expect(await taken).toEqual({ ok: true, id: idOf(2) })
    expect(relay.own).toEqual([`shown ${idOf(1)}`, `confirmed ${idOf(1)}`, `shown ${idOf(2)}`, `confirmed ${idOf(2)}`])
  })

  it('once the message is accepted, the reply that waited for it is sent', async () => {
    const answer = pending()
    relay.publish.mockResolvedValueOnce({ ok: true, id: idOf(2) })
    const { result } = mount({ container: channel, rootIds: [] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let reply: Promise<unknown> = Promise.resolve()
    await act(async () => {
      void result.current.actions.comment('hello')
    })
    await act(async () => {
      reply = result.current.actions.reply({ id: idOf(1) } as never, 'and more')
    })
    await answer({ ok: true, id: idOf(1) })
    expect(await reply).toEqual({ ok: true, id: idOf(2) })
    expect(relay.own).toEqual([`shown ${idOf(1)}`, `confirmed ${idOf(1)}`, `shown ${idOf(2)}`, `confirmed ${idOf(2)}`])
  })
})

describe('useFileConversation — a resolution re-reads only after the relay took it (UNI-5)', () => {
  /*
    A resolution is not drawn ahead as a message is: the re-read is what shows
    it. Asked before the relay holds it, the catch-up draws the comment as it
    was, and the person's resolve seems undone until the next one (PEE-50's
    planted bug, which nothing caught).
  */
  it('asks nothing while the resolution is out, and catches up once it is accepted', async () => {
    let answer!: (result: { ok: true; id: string }) => void
    relay.resolve.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let resolved: Promise<unknown> = Promise.resolve()
    await act(async () => {
      resolved = result.current.actions.resolve('r1', 'resolved')
    })
    expect(relay.catchUp).not.toHaveBeenCalled()
    await act(async () => answer({ ok: true, id: idOf(9) }))
    expect(await resolved).toEqual({ ok: true, id: idOf(9) })
    expect(relay.catchUp).toHaveBeenCalledTimes(1)
  })

  it('a resolution the relay refused is reported, and nothing is re-read', async () => {
    relay.resolve.mockResolvedValueOnce({ ok: false, reason: 'restricted: not a member' })
    const { result } = mount({ container, rootIds: ['r1'] })
    await waitFor(() => expect(result.current.state).toBe(empty))
    let resolved: unknown
    await act(async () => {
      resolved = await result.current.actions.resolve('r1', 'resolved')
    })
    expect(resolved).toEqual({ ok: false, reason: 'restricted: not a member' })
    expect(relay.catchUp).not.toHaveBeenCalled()
  })
})
