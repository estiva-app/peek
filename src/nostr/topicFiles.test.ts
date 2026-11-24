/**
 * A topic's files (TOP-3): Add file and Remove write one `kind:1851` entry on
 * the topic, filed in the topic's own Folder and naming the file by its id in
 * `o` (SPEC §6.14), and the read returns only the files the viewer can find —
 * an id nobody holds is not drawn and not counted (§3.2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishSigned, signViaEstivaId, queryRelay } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
  queryRelay: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay }))

import { setTopicFileAsViewer, topicFilesAsViewer } from './foreign'
import { relayAnswer } from '@/test/listRead'

const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const TOPIC_D = '7a384136-31a6-4d91-80ac-1d599464d2f2'
const TOPIC = `30840:${VIEWER}:${TOPIC_D}`
const PROJECT_D = '0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f'
const token = { accessToken: 't', pubkey: VIEWER } as never

/** Every unsigned event handed to the signer, in order. */
const sent = () => signViaEstivaId.mock.calls.map(([event]) => event as { kind: number; pubkey: string; tags: string[][] })
const tag = (event: { tags: string[][] }, name: string) => event.tags.filter((t) => t[0] === name).map((t) => t[1])

beforeEach(() => {
  publishSigned.mockReset().mockResolvedValue({ ok: true })
  signViaEstivaId.mockReset().mockImplementation(async (event: unknown) => event)
  queryRelay.mockReset()
})

const event = (kind: number, tags: string[][], created_at = 100) => ({ id: `${kind}${created_at}${tags.length}`.padStart(64, '0'), kind, pubkey: VIEWER, created_at, tags, content: '', sig: '' })
const root = event(30840, [['d', TOPIC_D], ['title', 'Widgets'], ['h', FOLDER]])

describe('adding and removing a file on a topic', () => {
  // The topic is opened first: an entry follows the topic's first record for a file never listed (SPEC §6.14).
  beforeEach(() => {
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => ({ ok: true, events: relayAnswer([root], filters) }))
  })

  it('Add file signs one change on the topic, in its Folder, naming the file by its id', async () => {
    const result = await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: PROJECT_D, listed: true }, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(sent()).toHaveLength(1)
    const entry = sent()[0]!
    expect(tag(entry, 'prev')).toEqual([root.id])
    expect(entry.kind).toBe(1851)
    expect(entry.pubkey).toBe(VIEWER)
    expect(tag(entry, 'a')).toEqual([TOPIC])
    expect(tag(entry, 'O')).toEqual([TOPIC_D])
    expect(tag(entry, 'field')).toEqual([`lists:${PROJECT_D}`])
    expect(tag(entry, 'value')).toEqual(['true'])
    expect(tag(entry, 'h')).toEqual([FOLDER])
    expect(tag(entry, 'o')).toEqual([PROJECT_D])
    // A listing adds nobody to the file.
    expect(tag(entry, 'p')).toEqual([])
  })

  it('Remove signs the same entry set to false', async () => {
    await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: PROJECT_D, listed: false }, 'https://relay.test', token)

    expect(tag(sent()[0]!, 'value')).toEqual(['false'])
    expect(tag(sent()[0]!, 'field')).toEqual([`lists:${PROJECT_D}`])
  })

  it("hands back the relay's refusal as what the person reads", async () => {
    publishSigned.mockResolvedValue({ ok: false, reason: 'restricted: not a member of this group' })

    const result = await setTopicFileAsViewer({ topic: TOPIC, folder: FOLDER, file: PROJECT_D, listed: true }, 'https://relay.test', token)

    expect(result).toEqual({ ok: false, reason: 'restricted: not a member of this group' })
  })
})

describe("reading a topic's files", () => {
  const entryOf = (file: string, value: string, at: number) =>
    event(1851, [['a', TOPIC], ['O', TOPIC_D], ['field', `lists:${file}`], ['value', value], ['h', FOLDER], ['ts', String(at * 1000)], ['o', file]], at)
  const project = event(30850, [['d', PROJECT_D], ['title', 'Widgets 2: build 1']])

  it('returns the files it can find, and not one whose id nobody it can read holds, nor one taken off', async () => {
    const world = [root, project, entryOf(PROJECT_D, 'true', 100), entryOf('gone', 'true', 101), entryOf('removed', 'true', 102), entryOf('removed', 'false', 103)]
    queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => ({ ok: true, events: relayAnswer(world, filters) }))

    const files = await topicFilesAsViewer(TOPIC, 'https://relay.test', token)

    expect(files.map((f) => [f.file, f.address])).toEqual([[PROJECT_D, `30850:${VIEWER}:${PROJECT_D}`]])
  })

  it('throws on a refused read rather than answering that the topic lists nothing', async () => {
    queryRelay.mockResolvedValue({ ok: false, reason: 'auth-required' })

    await expect(topicFilesAsViewer(TOPIC, 'https://relay.test', token)).rejects.toThrow()
  })
})
