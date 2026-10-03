import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { channelContext, threadContext } from '@estiva-app/conversation'

const frontier = vi.hoisted(() => ({ merged: {} as Record<string, number>, ready: true }))
vi.mock('@/nostr/useReadStateSync', () => ({
  useReadFrontier: () => ({
    marker: (context: string | undefined) => (context ? frontier.merged[context] : undefined),
    merged: frontier.merged,
    ready: frontier.ready,
  }),
}))

const { useNewReplyThreads } = await import('./useNewReplyThreads')

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
