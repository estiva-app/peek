/**
 * The Desk's Open work dots follow what is said in a file's Folder — from the
 * tab's channel store, with no read after the first (OPT-5).
 *
 * Without that, a comment that arrived after the Desk loaded never lit the row
 * — and removing the "read" row handed it to the Screener, which showed it as
 * unread. It used to be done by reading every file's conversation again
 * whenever anything was said in any of their Folders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ConversationMessage, ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'

const api = vi.hoisted(() => ({
  conversations: vi.fn(async (): Promise<Record<string, unknown[]>> => ({})),
  tracked: [] as string[][],
  events: [] as unknown[],
}))
// The copy on the device holds nothing here (PEE-2): only the relay's reads are counted. One function, so the
// hook's effect sees the same seam on every render, as the real provider's is.
const { fromRelayOnly } = vi.hoisted(() => ({
  fromRelayOnly: (_files: unknown, source?: string) => (source === 'copy' ? Promise.resolve({}) : api.conversations()),
}))

vi.mock('@/api', () => ({
  useMembership: () => ({
    state: 'known',
    termsOf: () => ({ member: true, muted: false }),
    isMentioned: () => false,
  }),
  useForeignObjects: () => ({ conversations: fromRelayOnly }),
}))
vi.mock('@/nostr/useReadStateSync', () => ({
  useReadFrontier: () => ({ ready: true, marker: () => undefined, merged: {} }),
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => null, storedToken: () => null }))
vi.mock('./useChannelStreams', () => ({
  useChannelStreams: (channels: readonly string[]) => {
    api.tracked.push([...channels])
    return { at: 0, streams: {} }
  },
  useHeldChannelEvents: () => api.events,
}))

const ADDRESS = '30851:aa:one'
const OTHER = '30851:aa:two'
const FILE = { ref: ADDRESS, address: ADDRESS, folder: 'folder-1' } as unknown as ForeignObject
const files = [FILE]

let serial = 0
const event = (tags: string[][], over: Partial<SignedEvent> = {}) =>
  ({ id: (++serial).toString(16).padStart(64, '0'), pubkey: 'b'.repeat(64), created_at: 1_000 + serial, kind: 1111, content: '', sig: '', tags, ...over }) as SignedEvent
const commentOn = (address: string) => event([['A', address], ['a', address], ['K', '30851'], ['k', '30851'], ['h', 'folder-1']])
const replyTo = (root: SignedEvent, address: string) =>
  event([['A', address], ['K', '30851'], ['e', root.id], ['k', '1111'], ['h', 'folder-1']])

async function mount() {
  const { useLiveConversationBadges } = await import('./useConversationBadges')
  return renderHook(() => useLiveConversationBadges(files))
}

beforeEach(() => {
  // Each test gets its own held answers: they live at module level, across mounts.
  vi.resetModules()
  api.conversations.mockReset()
  api.conversations.mockImplementation(async () => ({ [ADDRESS]: [{ id: 'c1', root: 'c1', at: 90, by: 'a' }] }))
  api.tracked = []
  api.events = []
})

describe('useLiveConversationBadges', () => {
  it('tracks the files’ Folders in the channel store', async () => {
    await mount()
    expect(api.tracked.at(-1)).toEqual(['folder-1'])
  })

  it('a comment the store holds reaches the row with no read', async () => {
    const { result, rerender } = await mount()
    await waitFor(() => expect(result.current.counts[ADDRESS]).toBe(1))
    api.events = [commentOn(ADDRESS)]
    rerender()
    expect(result.current.counts[ADDRESS]).toBe(2)
    expect(api.conversations).toHaveBeenCalledTimes(1)
  })

  it('draws the last answer when the list is mounted again, and asks nothing (OPT-4)', async () => {
    const first = await mount()
    await waitFor(() => expect(first.result.current.counts[ADDRESS]).toBe(1))
    first.unmount()
    const again = await mount()
    expect(again.result.current.counts[ADDRESS]).toBe(1)
    expect(api.conversations).toHaveBeenCalledTimes(1)
  })

  it('a return draws what was said while away, and asks nothing', async () => {
    const first = await mount()
    await waitFor(() => expect(first.result.current.counts[ADDRESS]).toBe(1))
    first.unmount()
    api.events = [commentOn(ADDRESS)]
    const again = await mount()
    expect(again.result.current.counts[ADDRESS]).toBe(2)
    expect(api.conversations).toHaveBeenCalledTimes(1)
  })

  it('a refused read costs the badge, and is not asked again on a rerender', async () => {
    api.conversations.mockRejectedValue(new Error('rate-limited'))
    const { rerender } = await mount()
    await waitFor(() => expect(api.conversations).toHaveBeenCalledTimes(1))
    api.events = [commentOn(ADDRESS)]
    rerender()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.conversations).toHaveBeenCalledTimes(1)
  })
})

describe('foldHeldEvents — conversationsOf’s rule over what the store holds', () => {
  const answer: Record<string, ConversationMessage[]> = { [ADDRESS]: [{ id: 'c1', root: 'c1', at: 90, by: 'a' }], [OTHER]: [] }
  const both = [FILE, { ref: OTHER, address: OTHER, folder: 'folder-1' } as unknown as ForeignObject]

  it('a comment is its file’s, and a reply is in the thread of a root that file holds', async () => {
    const { foldHeldEvents } = await import('./useConversationBadges')
    const root = commentOn(OTHER)
    const reply = replyTo(root, OTHER)
    const out = foldHeldEvents(answer, both, [reply, root])
    expect(out[OTHER].map((m) => [m.id, m.root])).toEqual([
      [root.id, root.id],
      [reply.id, root.id],
    ])
    expect(out[ADDRESS]).toBe(answer[ADDRESS])
  })

  it('what is already in the answer, the Folder’s own chat, and a reply naming a different file are not counted', async () => {
    const { foldHeldEvents } = await import('./useConversationBadges')
    const root = commentOn(OTHER)
    const held = { ...answer, [OTHER]: [{ id: root.id, root: root.id, at: root.created_at, by: root.pubkey }] }
    const out = foldHeldEvents(held, both, [
      root,
      event([['h', 'folder-1']], { kind: 9 }),
      // Its root is OTHER's, but it names ADDRESS in its `A`: neither file's (CON-34).
      replyTo(root, ADDRESS),
    ])
    expect(out).toBe(held)
  })

  it('a reply that shares its root’s second, and sorts before it, is still in the thread', async () => {
    const { foldHeldEvents } = await import('./useConversationBadges')
    const root = commentOn(OTHER)
    const reply = { ...replyTo(root, OTHER), created_at: root.created_at, id: '0'.repeat(64) }
    const out = foldHeldEvents(answer, both, [reply, root])
    expect(out[OTHER].map((m) => m.id).sort()).toEqual([reply.id, root.id].sort())
  })

  it('a kind:9 carrying a file’s `a` — a pasted link — never counts as its comment (§6.4)', async () => {
    const { foldHeldEvents } = await import('./useConversationBadges')
    const pasted = event([['a', OTHER], ['h', 'folder-2']], { kind: 9, content: 'https://ship.estiva.app/issue/two' })
    expect(foldHeldEvents(answer, both, [pasted])).toBe(answer)
  })

  it('a file the answer never had stays unknown', async () => {
    const { foldHeldEvents } = await import('./useConversationBadges')
    const out = foldHeldEvents({ [ADDRESS]: [] }, both, [commentOn(OTHER)])
    expect(out[OTHER]).toBeUndefined()
  })
})
