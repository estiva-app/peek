import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { channelContext, fileContext, threadContext } from '@estiva-app/conversation'

const frontier = vi.hoisted(() => ({ merged: {} as Record<string, number>, ready: true }))
vi.mock('@/nostr/useReadStateSync', () => ({
  useReadFrontier: () => ({
    marker: (context: string | undefined) => (context ? frontier.merged[context] : undefined),
    merged: frontier.merged,
    ready: frontier.ready,
  }),
}))

const { useNewReplyThreads, useNewWhenDrawn, useReplyOnlyThread } = await import('./useNewReplyThreads')

const ME = 'a'.repeat(64)
const KAT = 'b'.repeat(64)
const H = '1c7a1f52-6721-42fe-a348-9efde8565374'
const ROOT = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)
const T = 1_790_000_000
const DM_CONTEXT = channelContext(H) as string
const THREAD_CONTEXT = threadContext(ROOT) as string
const reply = (id: string, author: string, createdAt: number) => ({ id: id.repeat(64).slice(0, 64), author, createdAt })

function lit(merged: Record<string, number>, replies: Record<string, ReturnType<typeof reply>[]>, ready = true) {
  frontier.merged = merged
  frontier.ready = ready
  return renderHook(() => useNewReplyThreads({ kind: 'channel', h: H }, replies, ME)).result.current
}

describe('useNewReplyThreads — the "new reply" on a thread (PEE-44)', () => {
  it('a reply newer than the DM marker, in a thread never opened, is new', () => {
    expect([...lit({ [DM_CONTEXT]: T }, { [ROOT]: [reply('1', KAT, T + 60)] })]).toEqual([ROOT])
  })

  it('opening the thread clears it: its marker covers the reply', () => {
    expect(lit({ [DM_CONTEXT]: T, [THREAD_CONTEXT]: T + 60 }, { [ROOT]: [reply('1', KAT, T + 60)] }).size).toBe(0)
  })

  it('a reply older than the DM marker is read (§11.3 until the cut-over ticket)', () => {
    expect(lit({ [DM_CONTEXT]: T + 120 }, { [ROOT]: [reply('1', KAT, T + 60)] }).size).toBe(0)
  })

  it('my own reply is never new, and only the thread with the new reply lights', () => {
    const result = lit({ [DM_CONTEXT]: T }, { [ROOT]: [reply('1', ME, T + 60)], [OTHER]: [reply('2', KAT, T + 30)] })
    expect([...result]).toEqual([OTHER])
  })

  it('nothing is new before the first merge has landed', () => {
    expect(lit({}, { [ROOT]: [reply('1', KAT, T + 60)] }, false).size).toBe(0)
  })
})

describe("a topic at All judges each file's threads by that file's own marker (TOPI-3)", () => {
  const TOPIC = `30840:${KAT}:launch`
  const ISSUE = `30851:${KAT}:issue-12`
  const TOPIC_CONTEXT = fileContext(TOPIC) as string
  const ISSUE_CONTEXT = fileContext(ISSUE) as string
  // ROOT is the topic's own thread; OTHER is on the issue, drawn in the topic.
  const streamOfRoot = (root: string) => (root === OTHER ? ({ kind: 'file', address: ISSUE } as const) : undefined)
  const replies = { [ROOT]: [reply('1', KAT, T + 60)], [OTHER]: [reply('2', KAT, T + 60)] }
  const judged = (merged: Record<string, number>) => {
    frontier.merged = merged
    frontier.ready = true
    return renderHook(() => ({
      replies: useNewReplyThreads({ kind: 'file', address: TOPIC }, replies, ME, streamOfRoot),
      drawn: useNewWhenDrawn({ kind: 'file', address: TOPIC }, [{ id: OTHER, author: KAT, createdAt: T + 30 }], {}, ME, streamOfRoot),
      only: useReplyOnlyThread({ kind: 'file', address: TOPIC }, [], replies, ME, streamOfRoot),
    })).result.current
  }

  it("the issue read past its reply: the issue's thread is not new, though the topic's marker is older", () => {
    const result = judged({ [TOPIC_CONTEXT]: T, [ISSUE_CONTEXT]: T + 120 })
    expect([...result.replies]).toEqual([ROOT])
    expect(result.drawn?.has(OTHER)).toBe(false)
    expect(result.only).toBe(ROOT)
  })

  it("the topic read past it and the issue not: the issue's thread and comment are new", () => {
    const result = judged({ [TOPIC_CONTEXT]: T + 120, [ISSUE_CONTEXT]: T })
    expect([...result.replies]).toEqual([OTHER])
    expect(result.drawn?.has(OTHER)).toBe(true)
    // Only a reply is new, and it is the issue's: that is the thread a Desk click opens.
    expect(result.only).toBe(OTHER)
  })
})
