/**
 * A topic just started shows in the columns beside its page once it is written (Katerina, 17 November, T-12): the
 * teams and the topics the viewer can read are read again when its writes land; never for one the relay refused.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reads = vi.hoisted(() => ({ topics: vi.fn(), teams: vi.fn(async () => {}), settled: undefined as Promise<{ ok: boolean }> | undefined }))
vi.mock('./useTopicsColumn', () => ({ readTopicsAgain: reads.topics }))
vi.mock('./useTeams', () => ({ reloadTeamsOnScreen: reads.teams }))
vi.mock('./pendingTopics', () => ({ topicSettled: () => reads.settled }))

import { showStartedTopicWhenWritten } from './topicStarted'

const ADDRESS = `30840:${'b'.repeat(64)}:new-topic`

beforeEach(() => {
  reads.topics.mockClear()
  reads.teams.mockClear()
  reads.settled = undefined
})

describe('a topic just started shows in the columns once it is written (T-12)', () => {
  it('reads the teams and the topics again once its writes land, not before', async () => {
    let land!: (outcome: { ok: boolean }) => void
    reads.settled = new Promise((resolve) => (land = resolve))
    showStartedTopicWhenWritten(ADDRESS)
    expect(reads.topics).not.toHaveBeenCalled()
    expect(reads.teams).not.toHaveBeenCalled()
    land({ ok: true })
    await reads.settled
    await Promise.resolve()
    expect(reads.topics).toHaveBeenCalledTimes(1)
    expect(reads.teams).toHaveBeenCalledTimes(1)
  })

  it('reads nothing for a topic the relay refused: it was taken back', async () => {
    reads.settled = Promise.resolve({ ok: false })
    showStartedTopicWhenWritten(ADDRESS)
    await reads.settled
    await Promise.resolve()
    expect(reads.topics).not.toHaveBeenCalled()
    expect(reads.teams).not.toHaveBeenCalled()
  })

  it('reads at once for one written before its page opened (not drawn ahead)', () => {
    showStartedTopicWhenWritten(ADDRESS)
    expect(reads.topics).toHaveBeenCalledTimes(1)
    expect(reads.teams).toHaveBeenCalledTimes(1)
  })
})
