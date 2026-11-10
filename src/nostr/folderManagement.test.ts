/**
 * Renaming, deleting and moving — the three writes that edit a Folder itself.
 *
 * Each has one property worth pinning, and in each case it is the thing that
 * goes wrong silently rather than the happy path:
 *
 *  - **No command carries a name** (MAN-17). A Folder's title is its channel's
 *    name, so a rename is the `kind:9002` alone.
 *  - **Move is one action per Folder it leaves** (TEA-3). Each `kind:1852 move`
 *    changes both lists or neither, so a refusal never leaves a file on no
 *    list, and the person is told what did move and why the rest did not.
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
import { SignRefused, SignerTokenExpired } from '@estiva-app/identity'
import { RELAY_BUSY_MESSAGE } from '@estiva-app/protocol'

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
    // The title is the channel's: a command carries no name (MAN-17).
    expect(tag(command, 'name')).toEqual([])
    expect(tag(sent()[0]!, 'name')).toEqual(['Leaf'])
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
  it('writes the channel and nothing else — the title is the 39000 name (SPEC §3.2)', async () => {
    const result = await renameFolderAsViewer(FOLDER, 'Renamed', 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    // One event, and never a 1852 — a command carries no name (MAN-17).
    expect(sent().map((e) => e.kind)).toEqual([9002])
    expect(tag(sent()[0]!, 'name')).toEqual(['Renamed'])
  })

  it('says the relay’s refusal — only owners and admins may rename', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'refused' })

    expect(await renameFolderAsViewer(FOLDER, 'Renamed', 'https://relay.test', token)).toEqual({ ok: false, reason: 'refused' })
  })
})

describe('moving a file', () => {
  const here = { id: FOLDER, hasState: true }
  const there = { id: OTHER, hasState: true }
  const file = { ref: ADDRESS, address: ADDRESS, folder: FOLDER }
  const listing = [file]

  it('sends one move: into the destination, naming the Folder it leaves (TEA-3)', async () => {
    await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here], there, 'https://relay.test', token)

    expect(sent().map((e) => [e.kind, tag(e, 'op')[0], tag(e, 'h')[0], tag(e, 'from')[0], tag(e, 'a')])).toEqual([[1852, 'move', OTHER, FOLDER, [ADDRESS]]])
  })

  it('moves a file its Folder lists by address in its state even when the listing read left it out', async () => {
    await moveFileAsViewer(file, new Map([[FOLDER, []]]), [{ ...here, addresses: [ADDRESS] }], there, 'https://relay.test', token)

    expect(sent().map((e) => [tag(e, 'op')[0], tag(e, 'h')[0], tag(e, 'from')[0], tag(e, 'a')])).toEqual([['move', OTHER, FOLDER, [ADDRESS]]])
  })

  /*
    TEA-3. A refused move changed neither list. The person reads Peek's words
    for why, never the relay's text, which is written for a developer.
  */
  it.each([
    ['invalid: team 31afb7af is archived; its list does not change', 'Nothing was moved: one of the teams is archived.'],
    ['invalid: channel is archived', 'Nothing was moved: one of the teams is archived.'],
    ["invalid: only the team's members mark or unmark its spaces", 'Nothing was moved: you need to be a member of both teams to move this.'],
    [`invalid: the team a move leaves does not list ${ADDRESS}`, 'Nothing was moved: the teams changed since you opened this. Try again.'],
    ['invalid: the team a move leaves lists none of its files', 'Nothing was moved: the teams changed since you opened this. Try again.'],
    ["invalid: a topic is listed by one team: take it off the other team's list first", 'Nothing was moved: the teams changed since you opened this. Try again.'],
    ['invalid: rate-limited', 'Nothing was moved. Try again.'],
    // TEA-9. A refusal is read by its reason code; a code Peek does not know says only that nothing moved.
    [
      'invalid: not-home: a topic on no team\'s list goes only to its home or the Company team',
      'Nothing was moved: it is in no team yet, so it can go only to the team it was started in, or to the Company team.',
    ],
    ['invalid: frozen: the team is frozen until Monday', 'Nothing was moved.'],
    ['invalid: leaves-by-moving: a topic leaves a team only by a move', 'Nothing was moved.'],
  ])('a refused move says why in Peek’s words, never the relay’s: %s', async (relayText, sentence) => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: relayText, httpStatus: 200 })

    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here], there, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toBe(sentence)
  })

  /*
    TEA-3. Peek's own failure on the way — the sign-in ended, Estiva ID would
    not sign, the relay busy or out of reach — is said as itself, on any move
    and not only the first, and with what did move when an earlier one landed.
  */
  it.each([
    ['the sign-in ended', () => signViaEstivaId.mockRejectedValueOnce(new SignerTokenExpired()), 'your sign-in has ended. Sign in again.'],
    ['Estiva ID would not sign', () => signViaEstivaId.mockRejectedValueOnce(new SignRefused(403, 'Estiva ID refused to sign kind:1852 — inactive')), 'Estiva ID would not sign it.'],
    ['the relay could not be reached', () => publishSigned.mockRejectedValueOnce(new TypeError('Failed to fetch')), 'the relay could not be reached. Try again.'],
    ['the relay is busy', () => publishSigned.mockResolvedValueOnce({ ok: false, reason: RELAY_BUSY_MESSAGE, httpStatus: 503 }), 'the relay is busy. Try again in a moment.'],
  ])('a move that fails on the way says so when %s', async (_case, fail, why) => {
    fail()

    // Resolves: a throw out of the move would reach the dialog, which closes on it with nothing said.
    await expect(moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here], there, 'https://relay.test', token)).resolves.toMatchObject({
      ok: false,
      reason: `Nothing was moved: ${why}`,
    })
  })

  it('a move that fails on the way after an earlier one landed says what did move', async () => {
    const THIRD = '33333333-3333-4333-8333-333333333333'
    signViaEstivaId.mockImplementationOnce(async (event: unknown) => event).mockRejectedValueOnce(new SignerTokenExpired())
    const result = moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here, { id: THIRD, hasState: true, addresses: [ADDRESS] }], there, 'https://relay.test', token)

    await expect(result).resolves.toEqual({ ok: false, landed: true, why: 'your sign-in has ended. Sign in again.', stillIn: [THIRD] })
    expect(publishSigned).toHaveBeenCalledTimes(1)
  })

  it('moves what is listed under the file with it: one move naming the set (FOL-45, MAN-17)', async () => {
    const SUB = `${ADDRESS}-sub`
    const sub = { ref: SUB, address: SUB, folder: FOLDER, parentRef: ADDRESS }
    await moveFileAsViewer(file, new Map([[FOLDER, [file, sub]]]), [here], there, 'https://relay.test', token)

    expect(sent().map((event) => [tag(event, 'op')[0], tag(event, 'h')[0], tag(event, 'from')[0], tag(event, 'a')])).toEqual([
      ['move', OTHER, FOLDER, [ADDRESS, SUB]],
    ])
  })

  it('sends nothing into a private folder when the file lives in another channel', async () => {
    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here],{ ...there, private: true }, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toMatch(/private team/)
    expect(sent()).toHaveLength(0)
  })

  it('writes nothing when the destination is where it already is', async () => {
    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here],here, 'https://relay.test', token)

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
    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here],{ id: OTHER, hasState: false }, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toMatch(/into it would hide/)
    expect(sent()).toHaveLength(0)
  })

  /*
    SHI-37, TEA-3. A file two Folders list can have a different set under it in
    each. One move from each, naming what that Folder lists — the planner Ship
    and the agent use — and each changes both lists or neither.
  */
  it('out of two folders: one move from each, naming what that Folder lists under it', async () => {
    const THIRD = '33333333-3333-4333-8333-333333333333'
    const subHere = { ref: `${ADDRESS}-a`, address: `${ADDRESS}-a`, folder: FOLDER, parentRef: ADDRESS }
    const subThird = { ref: `${ADDRESS}-b`, address: `${ADDRESS}-b`, folder: FOLDER, parentRef: ADDRESS }
    const listings = new Map([
      [FOLDER, [file, subHere]],
      [THIRD, [file, subThird]],
    ])
    await moveFileAsViewer(file, listings, [here, { id: THIRD, hasState: true }], there, 'https://relay.test', token)

    expect(sent().map((event) => [tag(event, 'op')[0], tag(event, 'h')[0], tag(event, 'from')[0], tag(event, 'a')])).toEqual([
      ['move', OTHER, FOLDER, [ADDRESS, subHere.address]],
      ['move', OTHER, THIRD, [ADDRESS, subThird.address]],
    ])
  })

  it('out of two folders, a refused first move sends nothing more and says nothing moved', async () => {
    const THIRD = '33333333-3333-4333-8333-333333333333'
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'invalid: channel is archived', httpStatus: 200 })
    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here, { id: THIRD, hasState: true, addresses: [ADDRESS] }], there, 'https://relay.test', token)

    expect(result).toEqual({
      ok: false,
      reason: 'Nothing was moved: one of the teams is archived.',
      why: 'one of the teams is archived.',
      stillIn: [FOLDER, THIRD],
    })
    expect(sent()).toHaveLength(1)
  })

  it('out of two folders, a refused second move names the Folder that still lists it', async () => {
    const THIRD = '33333333-3333-4333-8333-333333333333'
    publishSigned.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'invalid: the team a move leaves lists none of its files', httpStatus: 200 })
    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [here, { id: THIRD, hasState: true, addresses: [ADDRESS] }], there, 'https://relay.test', token)

    // Not "the move failed": the file did arrive, and saying it failed would
    // send somebody looking for it in the folder it already left.
    expect(result).toEqual({ ok: false, landed: true, why: 'the teams changed since you opened this. Try again.', stillIn: [THIRD] })
  })

  it('refuses, rather than reporting a move, out of a folder with no state that lists the file by containment', async () => {
    const result = await moveFileAsViewer(file, new Map([[FOLDER, listing]]), [{ id: FOLDER, hasState: false, addresses: [] }], there, 'https://relay.test', token)

    expect(result.ok === false && result.reason).toMatch(/out of this team/)
    expect(sent()).toHaveLength(0)
  })

  it('sends nothing for a file no folder lists and nothing is listed under — an issue', async () => {
    const issue = { ref: `30851:${'c'.repeat(64)}:i`, address: `30851:${'c'.repeat(64)}:i`, parentKind: 30850 }
    const result = await moveFileAsViewer(issue, new Map([[FOLDER, listing]]), [here], there, 'https://relay.test', token)

    expect(result).toEqual({ ok: true })
    expect(sent()).toHaveLength(0)
  })

  /*
    TEA-3, §3.3. A topic no Folder lists is placed, not moved: the Folder the
    dialog read it in lists none of it, and the relay refuses a move from a
    Folder that does. It goes only home — the team it was started in, or the
    company's Folder — and is never reported moved with nothing sent.
  */
  describe('a topic no Folder lists', () => {
    const TOPIC = `30840:${AUTHOR}:6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f`
    const send = (topic: { scopedTo: string }, to: { id: string; hasState: boolean; company?: boolean }) =>
      moveFileAsViewer({ ref: TOPIC, address: TOPIC, ...topic }, new Map([[FOLDER, []]]), [here], to, 'https://relay.test', token)
    const commands = () => sent().map((e) => [tag(e, 'op')[0], tag(e, 'h')[0], tag(e, 'from')[0], tag(e, 'a')])

    it('goes to the team it was started in: one add there', async () => {
      const result = await send({ scopedTo: OTHER }, there)

      expect(result).toEqual({ ok: true })
      expect(commands()).toEqual([['add', OTHER, undefined, [TOPIC]]])
    })

    it('goes to the company’s Folder: one add there', async () => {
      const result = await send({ scopedTo: FOLDER }, { ...there, company: true })

      expect(result).toEqual({ ok: true })
      expect(commands()).toEqual([['add', OTHER, undefined, [TOPIC]]])
    })

    it('is not sent to another team, and says where it can go', async () => {
      const result = await send({ scopedTo: FOLDER }, there)

      expect(result).toEqual({
        ok: false,
        reason: 'This topic is in no team yet, so it can go only to the one it was started in or to the Company team.',
      })
      expect(sent()).toHaveLength(0)
    })
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
    expect(filters.find((f) => f['#h'])).toMatchObject({ kinds: [30840, 30842, 30850, 30851], '#h': [FOLDER] })
  })

  it.each([
    ['it has state — a team, QA, any Folder made with New folder', [metadata(), admins(), roster(), event(30890, [['d', FOLDER]])], /files things/],
    ["it is a Ship project's record channel", [metadata('project-85db5b59'), admins(), roster()], /Ship project/],
    ['an issue is filed in it', [metadata(), admins(), roster(), event(30851, [['h', FOLDER]])], /filed/],
    ['a topic is filed in it', [metadata(), admins(), roster(), event(30840, [['h', FOLDER]])], /filed/],
    ['a Leaf document is filed in it — the relay refuses the delete since buzz#27', [metadata(), admins(), roster(), event(30842, [['h', FOLDER]])], /filed/],
    ['it is a DM, which names no owner — even for a steward', [event(39000, [['d', FOLDER], ['name', 'DM'], ['t', 'dm']]), event(39001, [['d', FOLDER]]), roster('admin')], /not a team/],
    ['the viewer is neither its owner nor a steward', [metadata(), admins(OTHER_PERSON), roster('member')], /made this team/],
    ['the relay does not answer for it', [], /could not be read/],
    [
      'only a roster somebody other than the relay signed makes the viewer a steward',
      [metadata(), admins(OTHER_PERSON), event(13534, [['member', AUTHOR, 'admin']], OTHER_PERSON)],
      /made this team/,
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

  it('says the relay’s "holds N file(s)" refusal in a person’s words (MAN-17)', async () => {
    publishSigned.mockResolvedValue({
      ok: false,
      reason: 'invalid: folder holds 2 file(s) (0 filed in it, 2 placed by its state); a delete would hide them all — remove them first',
    })

    expect(await deleteFolderAsViewer(FOLDER, 'https://relay.test', token)).toEqual({
      ok: false,
      reason: 'This team still has 2 files. Move or delete them first.',
    })
  })
})
