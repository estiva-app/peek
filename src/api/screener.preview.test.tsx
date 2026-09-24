/**
 * The Screener's hover card reads the relay (CON-14).
 *
 * `screener.preview` read Convex `messages` by a DM row's Convex id, and a file
 * row had no card. Now a DM row's card is what the channel store already holds
 * — no request at all — and a file row's is its screening comment plus the
 * replies under it, read once, on hover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { ScreenerPreviewSource } from '@/api/internal/screener'

vi.mock('@/api/store', () => ({ hasConvex: true }))
vi.mock('convex/react', () => ({
  useQuery: () => {
    throw new Error('the preview asked Convex')
  },
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ pubkey: 'me' }) }))

const THEM = 'b'.repeat(64)
vi.mock('@/api/people', () => ({ useMentionNames: () => [{ pubkey: THEM, name: 'Greg Bothman' }] }))

let sources: Record<string, ScreenerPreviewSource> = {}
vi.mock('@/api/internal/screener', () => ({
  useScreener: () => ({ previewOf: (id: string) => sources[id] }),
}))

const ADDRESS = `30840:${'a'.repeat(64)}:file`
const threads = vi.fn(async (_reference: string, rootIds: readonly string[]) => ({
  roots: {},
  replies: {
    [rootIds[0]]: Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      author: i === 5 ? 'me' : THEM,
      body: `reply ${i}`,
      createdAt: 1_787_000_000 + i,
      kind: 1111,
    })),
  },
}))
vi.mock('@/api/foreign', () => ({ useForeignObjects: () => ({ threads }) }))

async function preview(id: string | null) {
  const { useScreenerPreview } = await import('./screener')
  return renderHook(() => useScreenerPreview(id))
}

beforeEach(() => {
  vi.clearAllMocks()
  sources = {}
})

describe('a DM row', () => {
  it('shows the thread the fold holds, named, and reads nothing', async () => {
    sources = {
      dmRow: {
        kind: 'dm',
        messages: [
          { id: 'root', at: 1_787_000_000, by: 'me', root: 'root', about: [], urgent: false, body: 'question' },
          { id: 'r1', at: 1_787_000_010, by: THEM, root: 'root', about: [], urgent: false, body: 'answer' },
        ],
      },
    }
    const { result } = await preview('dmRow')
    expect(result.current).toMatchObject([
      { authorName: 'You', body: 'question', kind: 'message' },
      { authorName: 'Greg Bothman', body: 'answer', kind: 'reply' },
    ])
    expect(threads).not.toHaveBeenCalled()
  })
})

describe('a file row', () => {
  beforeEach(() => {
    sources = {
      fileRow: {
        kind: 'file',
        address: ADDRESS,
        comment: { id: 'c1', author: THEM, body: 'a comment', createdAt: 1_786_999_000 },
      },
    }
  })

  it('loads, then shows the comment and its last four replies — one read, by the comment', async () => {
    const { result } = await preview('fileRow')
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toHaveLength(5))
    expect(result.current!.map((r) => r.body)).toEqual(['a comment', 'reply 2', 'reply 3', 'reply 4', 'reply 5'])
    expect(result.current![0]).toMatchObject({ authorName: 'Greg Bothman', kind: 'message' })
    expect(result.current![4]).toMatchObject({ authorName: 'You', kind: 'reply' })
    expect(threads).toHaveBeenCalledTimes(1)
    expect(threads).toHaveBeenCalledWith(ADDRESS, ['c1'])
  })

  it('still shows the comment when the replies cannot be read', async () => {
    threads.mockRejectedValueOnce(new Error('rate_limited'))
    const { result } = await preview('fileRow')
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current![0].body).toBe('a comment')
  })
})

it('a row the Screener no longer holds shows nothing, and asks nothing', async () => {
  const { result } = await preview('gone')
  expect(result.current).toEqual([])
  expect(threads).not.toHaveBeenCalled()
})
