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

/*
  A listed file's fields as the resolve answers them: archived on its own, or
  only when read `archivedWith` (an issue of an archived project), as interop
  marks it.
*/
const resolved = vi.hoisted(() => ({ own: new Set<string>(), withParent: new Set<string>() }))
vi.mock('./foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./foreign')),
  useResolvedReferences: (refs: readonly string[], options?: { archivedWith?: boolean }) =>
    Object.fromEntries(
      refs.map((ref) => [
        ref,
        { ref, address: ref, slots: {}, ...(resolved.own.has(ref) || (options?.archivedWith && resolved.withParent.has(ref)) ? { archived: { by: VIEWER, at: 1 } } : {}) },
      ]),
    ),
}))

import { useTopicFiles } from './useTopicFiles'

const FOLDER = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const TOPIC_D = '7a384136-31a6-4d91-80ac-1d599464d2f2'
const TOPIC = `30840:${VIEWER}:${TOPIC_D}`
const PROJECT_D = '0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f'
const ISSUE_D = 'c579e675-6365-4b62-9cc1-d14495c22ca2'
const ISSUE2_D = '5d1c0a2e-8f3b-4c6e-9a7d-2b4e6f8a0c1d'
/** Listed, but no file the viewer can read answers it: a page in a team they are not in. */
const HIDDEN_D = 'e2a4c6e8-0b1d-4f3a-8c5e-7a9b1d3f5a7c'

const tag = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]
const event = (kind: number, tags: string[][]) => ({ id: `${kind}-${tags[0]?.[1]}`, kind, pubkey: VIEWER, created_at: 100, tags, content: '', sig: '' })
const roots = [
  event(30840, [['d', TOPIC_D], ['title', 'Widgets'], ['h', FOLDER]]),
  event(30850, [['d', PROJECT_D], ['title', 'Widgets 2: build 1']]),
  event(30851, [['d', ISSUE_D], ['title', 'Testing Widgets']]),
  event(30851, [['d', ISSUE2_D], ['title', 'Ship Widgets']]),
]
const filesOf = (state: unknown) => (typeof state === 'object' && state && 'files' in state ? (state as { files: Array<{ file: string }> }).files.map((f) => f.file) : state)

beforeEach(() => {
  resolved.own = new Set()
  resolved.withParent = new Set()
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

  it('marks a listed file archived on its own, or with the project above it, for the Overview’s Archived line (TOPI-10)', async () => {
    const PROJECT = `30850:${VIEWER}:${PROJECT_D}`
    const ISSUE = `30851:${VIEWER}:${ISSUE_D}`
    // The issue's own fields are not archived: only its project is, which archives it with it.
    resolved.withParent.add(ISSUE)
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(result.current.state)).toEqual([]))
    await act(async () => void (await result.current.setListed(PROJECT_D, true)))
    await act(async () => void (await result.current.setListed(ISSUE_D, true)))
    const archived = (state: unknown) => (state as { files: Array<{ address: string; archived?: boolean }> }).files.map((f) => [f.address, f.archived])
    expect(archived(result.current.state)).toEqual([
      [PROJECT, false],
      [ISSUE, true],
    ])
  })
})

describe('useTopicFiles arranging (TOPI-5)', () => {
  /** The topic listing the project, then the issue: drawn in that order, neither placed. */
  async function listedTwo() {
    const hook = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(hook.result.current.state)).toEqual([]))
    await act(async () => void (await hook.result.current.setListed(PROJECT_D, true)))
    await act(async () => void (await hook.result.current.setListed(ISSUE_D, true)))
    expect(filesOf(hook.result.current.state)).toEqual([PROJECT_D, ISSUE_D])
    return hook
  }
  const newest = () => relay.entries[relay.entries.length - 1]!
  const fieldsOf = (e: { tags: string[][] }) => e.tags.filter((t) => t[0] === 'field').map((t) => t[1])

  it('a move signs a place for the file on the topic, in its Folder, and draws the order the relay then holds', async () => {
    const { result } = await listedTwo()

    let answer: unknown
    await act(async () => void (answer = await result.current.move(ISSUE_D, null)))

    expect(answer).toEqual({ ok: true })
    expect(newest().kind).toBe(1851)
    expect(tag(newest(), 'a')).toBe(TOPIC)
    expect(tag(newest(), 'h')).toBe(FOLDER)
    expect(fieldsOf(newest())).toContain(`order:${ISSUE_D}`)
    expect(filesOf(result.current.state)).toEqual([ISSUE_D, PROJECT_D])
  })

  it('a move the relay refuses leaves the file where it was, and says it did not save', async () => {
    const { result } = await listedTwo()
    relay.publishSigned.mockImplementation(async () => ({ ok: false, reason: 'blocked: not a member' }))

    let answer: unknown
    await act(async () => void (answer = await result.current.move(ISSUE_D, null)))

    expect(answer).toEqual({ ok: false, reason: 'Couldn’t move the file. It’s back where it was.' })
    expect(filesOf(result.current.state)).toEqual([PROJECT_D, ISSUE_D])
  })

  it('Show as Row signs the file’s look on the topic and draws it', async () => {
    const { result } = await listedTwo()

    await act(async () => void (await result.current.setLook(PROJECT_D, 'row')))

    expect(fieldsOf(newest())).toEqual([`look:${PROJECT_D}`])
    expect(tag(newest(), 'value')).toBe('row')
    const files = (result.current.state as { files: Array<{ file: string; listed: { look?: string } }> }).files
    expect(files.find((f) => f.file === PROJECT_D)?.listed.look).toBe('row')
  })

  it('Undo of Remove lists the file again, then puts it back in its place with its look', async () => {
    const { result } = await listedTwo()
    await act(async () => void (await result.current.setLook(ISSUE_D, 'row')))
    await act(async () => void (await result.current.move(ISSUE_D, null)))
    const gone = (result.current.state as unknown as { files: Array<{ file: string; listed: never }> }).files.find((f) => f.file === ISSUE_D)!.listed
    await act(async () => void (await result.current.setListed(ISSUE_D, false)))
    expect(filesOf(result.current.state)).toEqual([PROJECT_D])
    const before = relay.entries.length

    await act(async () => void (await result.current.putBack(gone, null)))

    const sentNow = relay.entries.slice(before)
    expect(fieldsOf(sentNow[0]!)).toEqual([`lists:${ISSUE_D}`])
    expect(tag(sentNow[0]!, 'value')).toBe('true')
    expect(sentNow.slice(1).flatMap(fieldsOf)).toContain(`order:${ISSUE_D}`)
    expect(filesOf(result.current.state)).toEqual([ISSUE_D, PROJECT_D])
    const files = (result.current.state as { files: Array<{ file: string; listed: { look?: string } }> }).files
    expect(files[0]?.listed.look).toBe('row')
  })

  it('a move among unplaced files places a file this viewer cannot see too, so it keeps its place for those who can', async () => {
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(result.current.state)).toEqual([]))
    for (const d of [PROJECT_D, HIDDEN_D, ISSUE_D, ISSUE2_D]) await act(async () => void (await result.current.setListed(d, true)))
    expect(filesOf(result.current.state)).toEqual([PROJECT_D, ISSUE_D, ISSUE2_D])
    const before = relay.entries.length

    await act(async () => void (await result.current.move(PROJECT_D, ISSUE_D)))

    // Every file above where it lands is placed, in the order everyone reads: the one only others see, between.
    // One change of several fields: each as `["set", field, value, prev]`.
    const sent = relay.entries.slice(before)
    expect(sent).toHaveLength(1)
    const keys = new Map(sent[0]!.tags.filter((t) => t[0] === 'set').map((t) => [t[1], t[2]!]))
    expect([...keys.keys()].sort()).toEqual([`order:${HIDDEN_D}`, `order:${ISSUE_D}`, `order:${PROJECT_D}`].sort())
    const keyOf = (d: string) => keys.get(`order:${d}`)!
    expect(keyOf(HIDDEN_D) < keyOf(ISSUE_D) && keyOf(ISSUE_D) < keyOf(PROJECT_D)).toBe(true)
    expect(filesOf(result.current.state)).toEqual([ISSUE_D, PROJECT_D, ISSUE2_D])
  })

  it('a second drop while the first is saving lands where it was dropped, planned on the places the first wrote', async () => {
    const { result } = renderHook(() => useTopicFiles(TOPIC, FOLDER))
    await waitFor(() => expect(filesOf(result.current.state)).toEqual([]))
    for (const d of [ISSUE_D, PROJECT_D, ISSUE2_D]) await act(async () => void (await result.current.setListed(d, true)))
    await act(async () => void (await result.current.move(PROJECT_D, ISSUE_D)))
    expect(filesOf(result.current.state)).toEqual([ISSUE_D, PROJECT_D, ISSUE2_D])

    // The project to the top, and at once the second issue just after it.
    await act(async () => {
      const first = result.current.move(PROJECT_D, null)
      await Promise.resolve()
      const second = result.current.move(ISSUE2_D, PROJECT_D)
      await Promise.all([first, second])
    })

    expect(filesOf(result.current.state)).toEqual([PROJECT_D, ISSUE2_D, ISSUE_D])
  })

  it('Undo whose place cannot be read after the file is listed again says it is back at the end, and draws it there', async () => {
    const { result } = await listedTwo()
    const gone = (result.current.state as unknown as { files: Array<{ file: string; listed: never }> }).files.find((f) => f.file === PROJECT_D)!.listed
    await act(async () => void (await result.current.setListed(PROJECT_D, false)))
    // The listing goes through; every read after it is refused.
    const listing = relay.publishSigned.getMockImplementation()!
    relay.publishSigned.mockImplementation(async (...args: unknown[]) => {
      const answer = await listing(...(args as [string, { kind: number; created_at: number; tags: string[][] }]))
      relay.refuse = true
      return answer
    })

    let answer: unknown
    await act(async () => void (answer = await result.current.putBack(gone, null)))

    expect(fieldsOf(relay.entries[relay.entries.length - 1]!)).toEqual([`lists:${PROJECT_D}`])
    expect(answer).toEqual({ ok: false, reason: 'The file is back, at the end: its place couldn’t be saved.' })
    expect(filesOf(result.current.state)).toEqual([ISSUE_D, PROJECT_D])
  })
})
