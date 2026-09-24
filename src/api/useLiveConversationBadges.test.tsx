/**
 * The Desk's Open work dots re-read when something is said in a file's Folder.
 *
 * Without a signal the badges read once per set, so a comment that arrived
 * after the Desk loaded never lit the row — and removing the "read" row handed
 * it to the Screener, which re-reads every minute and showed it as unread.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'

const api = vi.hoisted(() => ({
  conversations: vi.fn(async () => ({})),
  tracked: [] as string[][],
  streams: {} as Record<string, { id: string; at: number }[]>,
}))

vi.mock('@/api', () => ({
  useFollows: () => ({ state: 'present', isFollowed: () => true }),
  useForeignObjects: () => ({ conversations: api.conversations }),
}))
vi.mock('@/nostr/useReadStateSync', () => ({
  useReadFrontier: () => ({ ready: true, marker: () => undefined }),
}))
vi.mock('@/auth/estivaId', () => ({ validToken: () => null }))
vi.mock('./useChannelStreams', () => ({
  useChannelStreams: (channels: readonly string[]) => {
    api.tracked.push([...channels])
    return { at: 0, streams: api.streams }
  },
}))

const FILE = { ref: '30851:aa:one', address: '30851:aa:one', folder: 'folder-1' } as unknown as ForeignObject
const files = [FILE]

async function mount() {
  const { useLiveConversationBadges } = await import('./useConversationBadges')
  return renderHook(() => useLiveConversationBadges(files))
}

beforeEach(() => {
  api.conversations.mockClear()
  api.tracked = []
  api.streams = { 'folder-1': [{ id: 'm1', at: 100 }] }
})

describe('useLiveConversationBadges', () => {
  it('tracks the files’ Folders in the channel store', async () => {
    await mount()
    expect(api.tracked.at(-1)).toEqual(['folder-1'])
  })

  it('re-reads the conversations when a newer message lands in a file’s Folder', async () => {
    const { rerender } = await mount()
    expect(api.conversations).toHaveBeenCalledTimes(1)
    api.streams = { 'folder-1': [{ id: 'm1', at: 100 }, { id: 'm2', at: 200 }] }
    rerender()
    expect(api.conversations).toHaveBeenCalledTimes(2)
  })

  it('does not re-read when the store changes and nothing newer was said', async () => {
    const { rerender } = await mount()
    api.streams = { 'folder-1': [{ id: 'm1', at: 100 }] }
    rerender()
    expect(api.conversations).toHaveBeenCalledTimes(1)
  })
})
