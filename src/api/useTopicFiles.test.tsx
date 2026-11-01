/**
 * A topic's files as the Files section holds them (TOP-3): each write is read
 * back from the relay before it is drawn, the entry is filed in the topic's own
 * Folder, and a failed read never takes away files already drawn.
 *
 * The relay is faked at the bridge, so what is asserted is the signed entry and
 * the list the relay's answer folds to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

const VIEWER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

const relay = vi.hoisted(() => ({
  /** The `kind:1851` entries the relay holds. */
  entries: [] as Array<{ kind: number; created_at: number; tags: string[][] }>,
  /** Whether a read of the entries is refused. */
  refuse: false,
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
  queryRelay: vi.fn(),
}))
vi.mock('@/nostr/bridge', () => ({ publishSigned: relay.publishSigned, signViaEstivaId: relay.signViaEstivaId, queryRelay: relay.queryRelay }))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/heldSession', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/auth/heldSession')),
  heldToken: () => ({ accessToken: 't', pubkey: VIEWER }),
}))

import { useTopicFiles } from './useTopicFiles'

const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const TOPIC_D = '7a384136-31a6-4d91-80ac-1d599464d2f2'
const TOPIC = `30840:${VIEWER}:${TOPIC_D}`
const PROJECT_D = '0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f'
const ISSUE_D = 'c579e675-6365-4b62-9cc1-d14495c22ca2'

const tag = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]
const event = (kind: number, tags: string[][]) => ({ id: `${kind}-${tags[0]?.[1]}`, kind, pubkey: VIEWER, created_at: 100, tags, content: '', sig: '' })
const roots = [
  event(30840, [['d', TOPIC_D], ['title', 'Widgets'], ['h', FOLDER]]),
  event(30850, [['d', PROJECT_D], ['title', 'Widgets 2: build 1']]),
  event(30851, [['d', ISSUE_D], ['title', 'Testing Widgets']]),
]
const filesOf = (state: unknown) => (typeof state === 'object' && state && 'files' in state ? (state as { files: Array<{ file: string }> }).files.map((f) => f.file) : state)

beforeEach(() => {
  relay.entries = []
  relay.refuse = false
  relay.signViaEstivaId.mockReset().mockImplementation(async (unsigned: unknown) => unsigned)
  relay.publishSigned.mockReset().mockImplementation(async (_url: string, signed: { kind: number; created_at: number; tags: string[][] }) => {
    relay.entries.push({ ...signed, created_at: relay.entries.length + 200 })
    return { ok: true }
  })
  relay.queryRelay.mockReset().mockImplementation(async (_url: string, filters: Array<Record<string, unknown>>) => {
    const f = filters[0]!
    if (f['#O']) return relay.refuse ? { ok: false, reason: 'rate-limited' } : { ok: true, events: relay.entries.map((e, at) => ({ id: `e${at}`, pubkey: VIEWER, content: '', sig: '', ...e })) }
    const ds = (f['#d'] as string[] | undefined) ?? []
    return { ok: true, events: roots.filter((e) => ds.includes(tag(e, 'd')!) && (f.kinds as number[]).includes(e.kind)) }
  })
})

describe('useTopicFiles', () => {
  it('Add file shows the file once the relay holds its entry, filed in the topic’s own Folder', async () => {
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(result.current.state)).toEqual([]))

    await act(async () => {
      expect(await result.current.setListed(PROJECT_D, true)).toEqual({ ok: true })
    })

    expect(relay.entries).toHaveLength(1)
    expect(tag(relay.entries[0]!, 'h')).toBe(FOLDER)
    expect(tag(relay.entries[0]!, 'field')).toBe(`lists:${PROJECT_D}`)
    expect(filesOf(result.current.state)).toEqual([PROJECT_D])
  })

  it('Remove takes the file off the drawn list once the relay holds the entry that removes it', async () => {
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(result.current.state)).toEqual([]))
    await act(async () => void (await result.current.setListed(PROJECT_D, true)))
    expect(filesOf(result.current.state)).toEqual([PROJECT_D])

    await act(async () => void (await result.current.setListed(PROJECT_D, false)))

    expect(tag(relay.entries[1]!, 'value')).toBe('false')
    expect(filesOf(result.current.state)).toEqual([])
  })

  it('keeps the files drawn when a read after a good one fails, rather than saying it could not load them', async () => {
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(result.current.state)).toEqual([]))
    await act(async () => void (await result.current.setListed(PROJECT_D, true)))

    relay.refuse = true
    await act(async () => void (await result.current.setListed(ISSUE_D, true)))

    expect(filesOf(result.current.state)).toEqual([PROJECT_D])
  })

  it('is failed, never an empty list, when the first read is refused', async () => {
    relay.refuse = true
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))

    await waitFor(() => expect(result.current.state).toEqual({ failed: true }))
  })
})
