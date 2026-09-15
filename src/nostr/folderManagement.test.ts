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
 *  - **Delete must not touch the files.** A Folder is an association — RFC 0.4
 *    §2 — so deleting it unfiles its contents and destroys none of them.
 *  - **Create must give the Folder state** (PEE-31). The navigation lists only
 *    Folders with a `kind:30890`, so a bare channel is created and never seen.
 *    The one place a `kind:1852` on a stateless Folder is right: it holds
 *    nothing yet, so state listing nothing is the truth.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay: vi.fn() }))

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
  it('adds to the destination before removing from the source', async () => {
    await moveFileAsViewer(ADDRESS, FOLDER, OTHER, 'https://relay.test', token)

    const [add, remove] = sent()
    expect(tag(add!, 'h')).toEqual([OTHER])
    expect(tag(add!, 'op')).toEqual(['add'])
    expect(tag(remove!, 'h')).toEqual([FOLDER])
    expect(tag(remove!, 'op')).toEqual(['remove'])
    expect(tag(add!, 'a')).toEqual([ADDRESS])
  })

  it('leaves the file in both folders when the remove fails, and says so', async () => {
    publishSigned.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false })

    const result = await moveFileAsViewer(ADDRESS, FOLDER, OTHER, 'https://relay.test', token)

    // Not "the move failed": the file did arrive, and saying it failed would
    // send somebody looking for it in the folder it already left.
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/still in the old one/i)
  })

  it('never removes from the source when the add was refused', async () => {
    // The half that matters: a failed add must not be followed by a remove, or
    // the file ends up in neither folder.
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'refused' })

    const result = await moveFileAsViewer(ADDRESS, FOLDER, OTHER, 'https://relay.test', token)

    expect(result.ok).toBe(false)
    expect(sent()).toHaveLength(1)
    expect(tag(sent()[0]!, 'op')).toEqual(['add'])
  })

  it('writes nothing when the destination is where it already is', async () => {
    const result = await moveFileAsViewer(ADDRESS, FOLDER, FOLDER, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(sent()).toHaveLength(0)
  })
})

describe('deleting a folder', () => {
  it('deletes the channel and nothing else', async () => {
    const result = await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    const events = sent()
    expect(events.map((e) => e.kind)).toEqual([9008])
    expect(tag(events[0]!, 'h')).toEqual([FOLDER])
    // No kind:5, no `a` tags: the files are unfiled, not deleted.
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
