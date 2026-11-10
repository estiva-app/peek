/**
 * The launcher's message search names a file comment by its file (FOL-36).
 *
 * Search ran over `kinds: [9]` alone, so no comment on a bare file — 137 on
 * production as of 2026-09-18 — was findable. Now a hit that is a `kind:1111`
 * carries the file it is on, off its NIP-22 scope tag, and the file's title,
 * resolved once per distinct file so the row can say where the comment is. A
 * `kind:9` carries neither, and the launcher routes it by its Folder as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }), storedToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }) }))

const relay = vi.hoisted(() => ({
  search: vi.fn<(term: string) => Promise<unknown[]>>(async () => []),
  resolve: vi.fn<(address: string) => Promise<unknown>>(async () => null),
}))
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  searchMessagesAsViewer: (term: string) => relay.search(term),
  resolveObjectAsViewer: (address: string) => relay.resolve(address),
}))

import { useMessageSearch } from './foreign'

const AUTHOR = 'a'.repeat(64)
const TEAM = '925897ad-796e-4bc6-999c-ca19df26c4aa'
const FILE = `30840:${AUTHOR}:0f7d2c1e-2b0a-4a25-9a2a-1a2b3c4d5e6f`
const OTHER_FILE = `30851:${AUTHOR}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const event = (id: string, kind: number, tags: string[][]) => ({ id, kind, pubkey: AUTHOR, tags, content: `${id} says layout`, created_at: 1, sig: '' })

beforeEach(() => {
  relay.search.mockReset()
  relay.resolve.mockReset()
  relay.search.mockResolvedValue([])
  relay.resolve.mockResolvedValue(null)
})

describe('useMessageSearch over both kinds a conversation is written in', () => {
  it('names a comment’s file and its title; a topic message stays a Folder hit', async () => {
    relay.search.mockResolvedValue([
      event('m1', 9, [['h', 'topic-folder']]),
      event('c1', 1111, [['A', FILE], ['a', FILE], ['h', TEAM]]),
      // A reply: no lowercase `a`, the root on `e` (what `replyToCommentAsViewer` writes).
      event('c2', 1111, [['A', FILE], ['e', 'c1'], ['h', TEAM]]),
      event('c3', 1111, [['a', OTHER_FILE], ['h', TEAM]]),
    ])
    relay.resolve.mockImplementation(async (address) =>
      address === FILE ? { slots: { title: { value: 'FOL-15 test topic 2' } } } : { slots: { title: { value: 'The file route' } } },
    )
    const { result } = renderHook(() => useMessageSearch('layout'))
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'done', count: 4 }))
    expect(result.current.hits).toEqual([
      { id: 'm1', content: 'm1 says layout', pubkey: AUTHOR, createdAt: 1, folder: 'topic-folder' },
      { id: 'c1', content: 'c1 says layout', pubkey: AUTHOR, createdAt: 1, folder: TEAM, file: FILE, fileTitle: 'FOL-15 test topic 2' },
      { id: 'c2', content: 'c2 says layout', pubkey: AUTHOR, createdAt: 1, folder: TEAM, root: 'c1', file: FILE, fileTitle: 'FOL-15 test topic 2' },
      { id: 'c3', content: 'c3 says layout', pubkey: AUTHOR, createdAt: 1, folder: TEAM, file: OTHER_FILE, fileTitle: 'The file route' },
    ])
    // One resolve per distinct file, not per hit.
    expect(relay.resolve.mock.calls.map(([a]) => a)).toEqual([FILE, OTHER_FILE])
  })

  it('a failed resolve loses the title and keeps the hit — the row still opens', async () => {
    relay.search.mockResolvedValue([event('c1', 1111, [['A', FILE], ['h', TEAM]])])
    relay.resolve.mockRejectedValue(new Error('refused'))
    const { result } = renderHook(() => useMessageSearch('layout'))
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'done', count: 1 }))
    expect(result.current.hits[0]).toEqual({ id: 'c1', content: 'c1 says layout', pubkey: AUTHOR, createdAt: 1, folder: TEAM, file: FILE })
  })

  it('asks the relay for nothing when there are no file hits to name', async () => {
    relay.search.mockResolvedValue([event('m1', 9, [['h', 'topic-folder']])])
    const { result } = renderHook(() => useMessageSearch('layout'))
    await waitFor(() => expect(result.current.state).toEqual({ kind: 'done', count: 1 }))
    expect(relay.resolve).not.toHaveBeenCalled()
  })
})

describe('useMessageSearch waits for two letters, as file search does', () => {
  it('asks nothing for one letter, and asks from the second', async () => {
    vi.useFakeTimers()
    try {
      const { result, rerender } = renderHook(({ q }) => useMessageSearch(q), { initialProps: { q: 'r' } })
      await vi.advanceTimersByTimeAsync(1000)
      expect(relay.search).not.toHaveBeenCalled()
      expect(result.current.state).toEqual({ kind: 'idle' })

      rerender({ q: 're' })
      await vi.advanceTimersByTimeAsync(1000)
      expect(relay.search.mock.calls.map(([t]) => t)).toEqual(['re'])
    } finally {
      vi.useRealTimers()
    }
  })
})
