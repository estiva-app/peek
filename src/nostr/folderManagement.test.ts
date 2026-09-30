/**
 * Renaming, deleting and moving — the three writes that edit a Folder itself.
 *
 * Each has one property worth pinning, and in each case it is the thing that
 * goes wrong silently rather than the happy path:
 *
 *  - **Rename must not publish a `kind:1852` on a Folder with no state.**
 *    `handle_folder_command` builds the next contents from the *existing* state,
 *    so `op: add` with no addresses against no state emits folder state listing
 *    nothing. The Folder stops being read by containment and shows empty, which
 *    for a Folder whose contents are entirely implied by `h` is every file on
 *    screen. Nothing errors.
 *  - **Move must add before it removes.** There is no atomic move, so the order
 *    decides what a failure between the two leaves behind: in both Folders
 *    (visible, fixable) or in neither (looks like it was never there).
 *  - **Delete must not be sent at a Folder that holds anything** (FOL-9). A
 *    `kind:9008` hides every event carrying the Folder's `h`, Ship issues
 *    included, so it is refused with nothing signed unless the Folder has no
 *    state, is not a Ship record channel, has nothing filed in it and the
 *    viewer owns it.
 *  - **Create must give the Folder state** (PEE-31). The navigation lists only
 *    Folders with a `kind:30890`, so a bare channel is created and never seen.
 *    The one place a `kind:1852` on a stateless Folder is right: it holds
 *    nothing yet, so state listing nothing is the truth.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { publishSigned, signViaEstivaId, queryRelay } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
  queryRelay: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay }))

import {
  createFolderAsViewer,
  deleteFolderAsViewer,
  moveFileAsViewer,
  renameFolderAsViewer,
} from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const OTHER = '31afb7af-b3bb-4ec2-8f30-08ef9c05458c'
const ADDRESS = `30850:${AUTHOR}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const token = { accessToken: 't', pubkey: AUTHOR } as never

/** Every unsigned event handed to the signer, in order. */
const sent = () => signViaEstivaId.mock.calls.map(([event]) => event as {
  kind: number
  tags: string[][]
})
const tag = (event: { tags: string[][] }, name: string) =>
  event.tags.filter((t) => t[0] === name).map((t) => t[1])

beforeEach(() => {
  publishSigned.mockReset()
  signViaEstivaId.mockReset()
  signViaEstivaId.mockImplementation(async (event: unknown) => event)
  publishSigned.mockResolvedValue({ ok: true })
})

describe('creating a folder', () => {
  it('creates the channel and then names it as a Folder, so it has state', async () => {
    const result = await createFolderAsViewer('Leaf', 'https://relay.test', token)

    expect(result).toMatchObject({ ok: true })
    expect(sent().map((e) => e.kind)).toEqual([9007, 1852])
    const command = sent()[1]!
    expect(tag(command, 'h')).toEqual([(result as { id: string }).id])
    expect(tag(command, 'name')).toEqual(['Leaf'])
    expect(tag(command, 'op')).toEqual(['add'])
    // Nothing to list: the channel was created a moment ago.
    expect(tag(command, 'a')).toEqual([])
  })

  it('reports a partial create when the relay refused the state', async () => {
    publishSigned.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'refused' })

    const result = await createFolderAsViewer('Leaf', 'https://relay.test', token)

    expect(result.ok).toBe(false)
    expect((result as { reason: string }).reason).toMatch(/created but/)
  })

  it('sends no command when the channel itself was refused', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'refused' })

    const result = await createFolderAsViewer('Leaf', 'https://relay.test', token)

    expect(result).toEqual({ ok: false, reason: 'refused' })
    expect(sent().map((e) => e.kind)).toEqual([9007])
  })
})

describe('renaming a folder', () => {
  it('writes only the channel when the folder has no state', async () => {
    const result = await renameFolderAsViewer(FOLDER, 'Renamed', false, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    // One event, and emphatically not a 1852 — see this file's header.
    expect(sent().map((e) => e.kind)).toEqual([9002])
  })

  it('writes both when the folder has state, because state shadows the channel', async () => {
    /*
      `listFolders` reads `nameOf(state) ?? nameOf(channel)`. Writing only the
      channel would rename it nowhere a reader looks; writing only the state
      would leave every non-Folder surface on the old name, which is the stale
      name the project rename already produced once.
    */
    await renameFolderAsViewer(FOLDER, 'Renamed', true, 'https://relay.test', token)

    const kinds = sent().map((e) => e.kind)
    expect(kinds).toEqual([9002, 1852])
    const command = sent()[1]!
    expect(tag(command, 'name')).toEqual(['Renamed'])
    // `add` of nothing, which the handler resolves to `next = current`. `set`
    // would empty the Folder and there is no `rename` op.
    expect(tag(command, 'op')).toEqual(['add'])
    expect(tag(command, 'a')).toEqual([])
  })

  it('does not write the state name when the channel rename was refused', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'refused' })

    const result = await renameFolderAsViewer(FOLDER, 'Renamed', true, 'https://relay.test', token)

    expect(result).toEqual({ ok: false, reason: 'refused' })
    expect(sent().map((e) => e.kind)).toEqual([9002])
  })
})

describe('moving a file', () => {
  const here = { id: FOLDER, hasState: true }
  const there = { id: OTHER, hasState: true }

  it('adds to the destination before removing from the source', async () => {
    await moveFileAsViewer(ADDRESS, here, there, 'https://relay.test', token)

    const [add, remove] = sent()
    expect(tag(add!, 'h')).toEqual([OTHER])
    expect(tag(add!, 'op')).toEqual(['add'])
    expect(tag(remove!, 'h')).toEqual([FOLDER])
    expect(tag(remove!, 'op')).toEqual(['remove'])
    expect(tag(add!, 'a')).toEqual([ADDRESS])
  })

  it('leaves the file in both folders when the remove fails, and says so', async () => {
    publishSigned.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })

    const result = await moveFileAsViewer(ADDRESS, here, there, 'https://relay.test', token)

    // Not "the move failed": the file did arrive, and saying it failed would
    // send somebody looking for it in the folder it already left.
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/still in the old one/i)
  })

  it('never removes from the source when the add was refused', async () => {
    // The half that matters: a failed add must not be followed by a remove, or
    // the file ends up in neither folder.
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'refused' })

    const result = await moveFileAsViewer(ADDRESS, here, there, 'https://relay.test', token)

    expect(result).toEqual({ ok: false, reason: 'refused' })
    expect(sent()).toHaveLength(1)
    expect(tag(sent()[0]!, 'op')).toEqual(['add'])
  })

  it('moves what is listed under the file with it, every add before any remove (FOL-45)', async () => {
    const SUB = `${ADDRESS}-sub`
    await moveFileAsViewer([ADDRESS, SUB], here, there, 'https://relay.test', token)

    expect(sent().map((event) => [tag(event, 'op')[0], tag(event, 'h')[0], tag(event, 'a')[0]])).toEqual([
      ['add', OTHER, ADDRESS],
      ['add', OTHER, SUB],
      ['remove', FOLDER, ADDRESS],
      ['remove', FOLDER, SUB],
    ])
  })

  it('writes nothing when the destination is where it already is', async () => {
    const result = await moveFileAsViewer(ADDRESS, here, here, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(sent()).toHaveLength(0)
  })

  /*
    FOL-10. A Folder with no state lists what is filed in it by `h`, and any
    command against it emits state listing only what the command named — so an
    `add` would hide everything already there, and a `remove` would hide all of
    it. Nothing is sent, and the page is told why.
  */
  it('sends nothing when moving into a folder with no state', async () => {
    const result = await moveFileAsViewer(ADDRESS, here, { id: OTHER, hasState: false }, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toMatch(/into it would hide/)
    expect(sent()).toHaveLength(0)
  })

  it('sends nothing when moving out of a folder with no state', async () => {
    const result = await moveFileAsViewer(ADDRESS, { id: FOLDER, hasState: false }, there, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toMatch(/out of this folder/)
    expect(sent()).toHaveLength(0)
  })
})

describe('deleting a folder', () => {
  const OTHER_PERSON = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
  /** The relay's own key — the author of every `39000`, `39001`, `30890` and `13534`. */
  const RELAY = '8b75a34d'.padEnd(64, '0')
  const event = (kind: number, tags: string[][], pubkey = RELAY) => ({ kind, tags, pubkey, content: '', created_at: 0, id: '', sig: '' })
  const metadata = (name = 'scratch') => event(39000, [['d', FOLDER], ['name', name]])
  const admins = (owner = AUTHOR) => event(39001, [['d', FOLDER], ['p', owner, 'owner']])
  const roster = (role = 'member') => event(13534, [['member', AUTHOR, role]])
  /** What the relay answers for the Folder — an empty, stateless channel the viewer owns unless a test says otherwise. */
  const relayHolds = (...events: ReturnType<typeof event>[]) => queryRelay.mockResolvedValue({ ok: true, events })

  beforeEach(() => {
    queryRelay.mockReset()
    relayHolds(metadata(), admins(), roster())
  })

  it('asks the relay the same question its guard asks, filed kinds by h', async () => {
    await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)

    const filters = queryRelay.mock.calls[0]![1] as { kinds: number[]; '#h'?: string[] }[]
    expect(filters.find((f) => f['#h'])).toMatchObject({ kinds: [30840, 30850, 30851], '#h': [FOLDER] })
  })

  it.each([
    ['it has state — a team, QA, any Folder made with New folder', [metadata(), admins(), roster(), event(30890, [['d', FOLDER]])], /files things/],
    ["it is a Ship project's record channel", [metadata('project-85db5b59'), admins(), roster()], /Ship project/],
    ['an issue is filed in it', [metadata(), admins(), roster(), event(30851, [['h', FOLDER]])], /filed/],
    ['a topic is filed in it', [metadata(), admins(), roster(), event(30840, [['h', FOLDER]])], /filed/],
    ['it is a DM, which names no owner — even for a steward', [event(39000, [['d', FOLDER], ['name', 'DM'], ['t', 'dm']]), event(39001, [['d', FOLDER]]), roster('admin')], /not a folder/],
    ['the viewer is neither its owner nor a steward', [metadata(), admins(OTHER_PERSON), roster('member')], /made this folder/],
    ['the relay does not answer for it', [], /could not be read/],
    [
      'only a roster somebody other than the relay signed makes the viewer a steward',
      [metadata(), admins(OTHER_PERSON), event(13534, [['member', AUTHOR, 'admin']], OTHER_PERSON)],
      /made this folder/,
    ],
  ])('sends nothing when %s', async (_why, events, reason) => {
    relayHolds(...events)

    const result = await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toMatch(reason)
    expect(sent()).toHaveLength(0)
  })

  it("sends nothing when another Folder's state places it — the parent would keep a dead `a` (FOL-28)", async () => {
    const address = `39000:${RELAY}:${FOLDER}`
    queryRelay
      .mockResolvedValueOnce({ ok: true, events: [metadata()] })
      .mockResolvedValueOnce({ ok: true, events: [event(30890, [['d', OTHER], ['a', address]]), admins(), roster()] })

    const result = await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)

    const placement = (queryRelay.mock.calls[1]![1] as { kinds: number[]; '#a'?: string[]; authors?: string[] }[])[0]
    expect(placement).toMatchObject({ kinds: [30890], '#a': [address], authors: [RELAY] })
    expect(result.ok === false && result.reason).toMatch(/inside another/)
    expect(sent()).toHaveLength(0)
  })

  it('sends nothing when the check itself fails', async () => {
    queryRelay.mockResolvedValue({ ok: false, events: [], reason: 'rate-limited' })

    expect(await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)).toMatchObject({ ok: false })
    expect(sent()).toHaveLength(0)
  })

  it("lets a relay admin delete an empty Folder somebody else made", async () => {
    relayHolds(metadata(), admins(OTHER_PERSON), roster('admin'))

    expect(await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)).toEqual({ ok: true })
    expect(sent().map((e) => e.kind)).toEqual([9008])
  })

  it('deletes the channel and nothing else', async () => {
    const result = await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    const events = sent()
    expect(events.map((e) => e.kind)).toEqual([9008])
    expect(tag(events[0]!, 'h')).toEqual([FOLDER])
    // No kind:5, no `a` tags: nothing but the channel is named.
    expect(tag(events[0]!, 'a')).toEqual([])
  })

  it('reports a refusal rather than reading the status code', async () => {
    // The relay refuses as 200 with `accepted: false`, so `ok` is the only
    // signal — this is the trap the seam exists to absorb.
    publishSigned.mockResolvedValue({ ok: false, reason: 'not an admin' })

    expect(await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)).toEqual({
      ok: false,
      reason: 'not an admin',
    })
  })
})
