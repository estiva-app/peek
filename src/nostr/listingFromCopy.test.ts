/**
 * A reopen draws the teams from the copy on the device (THE-13).
 *
 * The Folder listing reads each team's files with list reads (SPEC §6.13, `fields`), and the copy refused every list
 * read, so on a reopen the listing waited for the relay. In Miky's reopens that was 3 s behind the reopen's catch-ups,
 * and the teams read, which starts from the listing, with it: Open work's icons changed last, at 5 s. These go through
 * the real interop and the real copy, with only the relay faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay, keep } = vi.hoisted(() => ({ queryRelay: vi.fn(), keep: { on: true } }))
vi.mock('./bridge', () => ({ queryRelay, queryRelayTimes: vi.fn(async () => []), publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { memorySnapshotStorage } from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'
import { answerFromCopy, keepRelayAnswer, resetDeviceCopyForTest } from './deviceCopy'
import { listFoldersAsViewer } from './foreign'
import { relayAnswer } from '@/test/listRead'

const RELAY = 'https://relay.test'
const VIEWER = 'b'.repeat(64)
const AUTHOR = 'a'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const token = { accessToken: 't', pubkey: VIEWER } as never

let seq = 0
const event = (partial: Partial<SignedEvent>): SignedEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: AUTHOR,
  created_at: 1_800_000_000 + seq,
  tags: [],
  content: '',
  kind: 1,
  ...partial,
})
const events: SignedEvent[] = [
  event({ kind: 39000, tags: [['d', TEAM], ['name', 'Design']] }),
  event({ kind: 30890, tags: [['d', TEAM], ['a', `39000::${TEAM}`], ['a', `30850:${AUTHOR}:plan`]] }),
  event({ kind: 30850, tags: [['d', 'plan'], ['title', 'Q4 plan']] }),
]

// The page's localStorage, which this environment lacks: where the device remembers whose copy it holds.
const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
  get length() {
    return kept.size
  },
  key: (i: number) => [...kept.keys()][i] ?? null,
})

beforeEach(() => {
  vi.useFakeTimers()
  resetDeviceCopyForTest(memorySnapshotStorage())
  keep.on = true
  queryRelay.mockReset()
  // The relay, and the bridge keeping each answer in the copy as `queryRelay` does.
  queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => {
    const answer = relayAnswer(events, filters)
    if (keep.on) keepRelayAnswer(RELAY, filters, VIEWER, answer)
    return { ok: true, events: answer }
  })
})

afterEach(() => {
  vi.useRealTimers()
  resetDeviceCopyForTest()
  kept.clear()
})

/** What a listing says a person sees: each team's name and the files it lists. */
const seen = (folders: Awaited<ReturnType<typeof listFoldersAsViewer>>) =>
  folders.map((folder) => ({ id: folder.id, name: folder.name, listedIn: folder.listedIn ?? [] }))

describe('the Folder listing on a reopen', () => {
  it('comes from the copy once the relay has answered it, the same as the relay’s, files listed by a list read included', async () => {
    const fromRelay = await listFoldersAsViewer(RELAY, token)
    expect(queryRelay.mock.calls.some(([, filters]) => (filters as Record<string, unknown>[]).some((f) => 'fields' in f))).toBe(true)
    await vi.advanceTimersByTimeAsync(100)

    expect(fromRelay.map((folder) => folder.name)).toContain('Design')

    queryRelay.mockClear()
    await expect(listFoldersAsViewer(RELAY, token, 'copy').then(seen)).resolves.toEqual(seen(fromRelay))
    expect(queryRelay).not.toHaveBeenCalled()
  })

  it('negative control: a copy that never kept the listing still waits for the relay', async () => {
    keep.on = false
    await listFoldersAsViewer(RELAY, token)
    await vi.advanceTimersByTimeAsync(100)
    await expect(listFoldersAsViewer(RELAY, token, 'copy')).rejects.toThrow(/not in the copy/)
  })
})

describe('a list read from the copy', () => {
  const list = { kinds: [30850], authors: [AUTHOR], '#d': ['plan'], limit: 1, fields: 'newest' }
  const plain = { kinds: [39000], limit: 500 }
  const project = events[2]
  const channel = events[0]
  const copy = (held: SignedEvent[] | null, answered: SignedEvent[] | null) => ({
    held: vi.fn(() => held),
    answer: vi.fn(() => answered),
  })

  it('is answered by its last answer, beside the plain reads asked with it, in the relay’s order', () => {
    expect(answerFromCopy(copy([project], [channel]), [plain, list])).toEqual([project, channel].sort((a, b) => b.created_at - a.created_at))
  })

  it('one the relay never answered leaves the whole read to the relay', () => {
    expect(answerFromCopy(copy(null, [channel]), [plain, list])).toBeNull()
  })

  it('an open read (`text`) is never answered from the copy', () => {
    expect(answerFromCopy(copy([project], []), [{ ...list, text: true }])).toBeNull()
  })
})
