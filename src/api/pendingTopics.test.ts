/*
  A topic Start opened before the relay had it (PEE-6): what a refusal says,
  and when, and how long the tree lists it.
*/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import {
  holdStartedTopic,
  listedNow,
  onTopicRefused,
  resetStartedTopicsForTests,
  startedFilesIn,
  topicTextBack,
  waitOnTopic,
  type RefusedTopic,
  type TopicOutcome,
} from './pendingTopics'

const FOLDER = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const ADDRESS = '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:3f0c'
const file = { ref: ADDRESS, address: ADDRESS, folder: FOLDER, slots: { title: { value: 'Launch plan' } } } as unknown as ForeignObject

function start() {
  let answer!: (outcome: TopicOutcome) => void
  const settled = new Promise<TopicOutcome>((resolve) => (answer = resolve))
  const forget = vi.fn()
  holdStartedTopic({ address: ADDRESS, naddr: 'naddr1x', fileId: '3f0c', title: 'Launch plan', folder: FOLDER, hasState: true, file }, settled, forget)
  return { answer, forget }
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  resetStartedTopicsForTests()
  vi.useRealTimers()
})

describe('a refused new topic', () => {
  it('is announced only once each message sent into it has said its text is back, and says text came back', async () => {
    const { answer, forget } = start()
    const heard: RefusedTopic[] = []
    onTopicRefused((refused) => heard.push(refused))
    const first = waitOnTopic(ADDRESS)!
    const second = waitOnTopic(ADDRESS)!
    answer({ ok: false, reason: 'invalid: bad signature' })
    expect(await first).toEqual({ ok: false, reason: 'invalid: bad signature' })
    await second
    await flush()
    expect(heard).toEqual([])
    topicTextBack(ADDRESS, false)
    await flush()
    expect(heard).toEqual([])
    topicTextBack(ADDRESS, true)
    await flush()
    expect(heard).toHaveLength(1)
    expect(heard[0]).toMatchObject({ title: 'Launch plan', folder: FOLDER, fileId: '3f0c', textBack: true })
    expect(forget).toHaveBeenCalledTimes(1)
    // Taken out of its Folder's listing.
    expect(startedFilesIn(FOLDER, [])).toEqual([])
  })

  it('says no text came back when nothing was sent into it', async () => {
    const { answer } = start()
    const heard: RefusedTopic[] = []
    onTopicRefused((refused) => heard.push(refused))
    answer({ ok: false, reason: 'invalid: bad signature' })
    await flush()
    expect(heard).toHaveLength(1)
    expect(heard[0].textBack).toBe(false)
  })

  it('is still announced when a message never says what came back', async () => {
    const { answer } = start()
    const heard: RefusedTopic[] = []
    onTopicRefused((refused) => heard.push(refused))
    void waitOnTopic(ADDRESS)
    answer({ ok: false, reason: 'invalid: bad signature' })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(heard).toEqual([])
    await vi.advanceTimersByTimeAsync(1_500)
    expect(heard).toHaveLength(1)
  })
})

describe('an accepted new topic', () => {
  it('is never announced, and stays in its Folder until a listing of that Folder holds it', async () => {
    const { answer, forget } = start()
    const heard: RefusedTopic[] = []
    onTopicRefused((refused) => heard.push(refused))
    expect(startedFilesIn(FOLDER, [])).toEqual([file])
    const waiting = waitOnTopic(ADDRESS)!
    answer({ ok: true })
    expect(await waiting).toEqual({ ok: true })
    await flush()
    expect(heard).toEqual([])
    expect(forget).not.toHaveBeenCalled()
    // A listing asked before the relay had it does not hold it: still drawn.
    listedNow(FOLDER, [], Date.now() - 60_000)
    expect(startedFilesIn(FOLDER, [])).toEqual([file])
    // Once one holds it, the listing's own row is the one drawn.
    listedNow(FOLDER, [file], Date.now() - 60_000)
    expect(startedFilesIn(FOLDER, [])).toEqual([])
  })

  it('is not drawn back in once a listing asked after it was accepted leaves it out — it was deleted or moved meanwhile', async () => {
    const { answer } = start()
    answer({ ok: true })
    await flush()
    listedNow(FOLDER, [], Date.now())
    expect(startedFilesIn(FOLDER, [])).toEqual([])
  })

  it('is not drawn twice in a listing that already holds it', () => {
    start()
    expect(startedFilesIn(FOLDER, [file])).toEqual([])
  })
})
