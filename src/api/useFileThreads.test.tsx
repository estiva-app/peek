/**
 * The replies under a file's comments (FOL-19), as another app's file's page reads them: read again when a comment
 * comes in, and meanwhile the replies already read stay drawn, never the thread panel's skeleton (Katerina,
 * 17 November: "IS there any other case where this happens?"). Another file's replies are never drawn for this one.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { FileThreads } from '@/nostr/foreign'

/** Each read the hook starts, by the comments it asked about, answered by the test when it chooses. */
const asked = vi.hoisted(() => [] as { file: string; roots: string[]; answer: (threads: unknown) => void }[])
// One function for the tab, as the seam hands it: a new one each render would read again each render.
const seam = vi.hoisted(() => ({
  fileThreads: (file: string, roots: string[]) => new Promise((answer) => asked.push({ file, roots, answer })),
}))
vi.mock('@/api', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useForeignObjects: () => seam,
}))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))

import { useFileThreads } from './useForeignConversation'

const FILE = '30851:aa:issue-1'
const OTHER = '30851:aa:issue-2'
const threadsWith = (replies: Record<string, string[]>) => ({ replies }) as unknown as FileThreads

describe('a file’s replies, read again when a comment comes in', () => {
  it('keeps the replies already read while the read with the new comment is out', async () => {
    const { result, rerender } = renderHook(({ file, roots }) => useFileThreads(file, roots), { initialProps: { file: FILE, roots: ['c1'] } })
    expect(result.current.state).toBe('loading')
    await act(async () => asked[0]!.answer(threadsWith({ c1: ['r1'] })))
    expect(result.current.state).toEqual(threadsWith({ c1: ['r1'] }))
    // A new comment: the read asks again, and the panel keeps what it had.
    rerender({ file: FILE, roots: ['c1', 'c2'] })
    expect(asked).toHaveLength(2)
    expect(result.current.state).toEqual(threadsWith({ c1: ['r1'] }))
    await act(async () => asked[1]!.answer(threadsWith({ c1: ['r1'], c2: [] })))
    expect(result.current.state).toEqual(threadsWith({ c1: ['r1'], c2: [] }))
  })

  it('never draws another file’s replies: a new file reads from nothing', async () => {
    asked.length = 0
    const { result, rerender } = renderHook(({ file, roots }) => useFileThreads(file, roots), { initialProps: { file: FILE, roots: ['c1'] } })
    await act(async () => asked[0]!.answer(threadsWith({ c1: ['r1'] })))
    rerender({ file: OTHER, roots: ['d1'] })
    expect(result.current.state).toBe('loading')
  })
})
