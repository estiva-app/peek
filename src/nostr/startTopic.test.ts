/*
  Starting a topic — a bare file, SPEC §6.7.

  The wire shape is asserted exactly, because §6.1 makes tag order part of the
  id, and the second write is asserted to happen only when the page said the
  Folder has state — the `kind:1852` that empties a stateless Folder is the
  failure peek#192 named, one call site over.
*/
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  publishSigned: vi.fn(),
  signViaEstivaId: vi.fn(),
}))
vi.mock('./bridge', () => ({ publishSigned, signViaEstivaId, queryRelay: vi.fn() }))

import { createTopicAsViewer } from './startTopic'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const PROJECT = `30850:${AUTHOR}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const token = { accessToken: 't', pubkey: AUTHOR } as never
const RELAY = 'https://relay.test'

const sent = () =>
  signViaEstivaId.mock.calls.map(([event]) => event as { kind: number; tags: string[][]; content: string })

beforeEach(() => {
  publishSigned.mockReset()
  signViaEstivaId.mockReset()
  signViaEstivaId.mockImplementation(async (event: unknown) => event)
  publishSigned.mockResolvedValue({ ok: true })
})

describe('starting a topic', () => {
  it('publishes a kind:30840 with d, title, h and the parent, in that order, and empty content', async () => {
    const result = await createTopicAsViewer(
      { folder: TEAM, title: 'Launch naming', parent: PROJECT, hasState: false },
      RELAY,
      token,
    )
    expect(result.ok).toBe(true)
    const [file] = sent()
    expect(file.kind).toBe(30840)
    expect(file.tags.map((t) => t[0])).toEqual(['d', 'title', 'h', 'a'])
    expect(file.tags[1][1]).toBe('Launch naming')
    expect(file.tags[2][1]).toBe(TEAM)
    expect(file.tags[3][1]).toBe(PROJECT)
    expect(file.content).toBe('')
    if (result.ok) {
      expect(result.address).toBe(`30840:${AUTHOR}:${file.tags[0][1]}`)
      expect(result.naddr).toMatch(/^naddr1/)
    }
  })

  it('seeds a summary as the root’s last tag, on one line and trimmed (SPEC §6.12)', async () => {
    await createTopicAsViewer(
      { folder: TEAM, title: 'Launch naming', summary: '  Where we pick the name.\n  Two weeks.  ', parent: PROJECT, hasState: false },
      RELAY,
      token,
    )
    const [file] = sent()
    expect(file.tags.map((t) => t[0])).toEqual(['d', 'title', 'h', 'a', 'summary'])
    expect(file.tags[4]).toEqual(['summary', 'Where we pick the name. Two weeks.'])
  })

  it('writes no summary tag when the summary is blank', async () => {
    await createTopicAsViewer({ folder: TEAM, title: 'General thoughts', summary: '  \n ', hasState: false }, RELAY, token)
    expect(sent()[0].tags.map((t) => t[0])).toEqual(['d', 'title', 'h'])
  })

  it('omits the a tag for a topic at the top of the folder', async () => {
    await createTopicAsViewer({ folder: TEAM, title: 'General thoughts', hasState: false }, RELAY, token)
    expect(sent()[0].tags.map((t) => t[0])).toEqual(['d', 'title', 'h'])
  })

  it('writes only the file when the folder has no state', async () => {
    await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: false }, RELAY, token)
    // One event. A kind:1852 here would emit state listing nothing and empty
    // the Folder on every surface.
    expect(sent().map((e) => e.kind)).toEqual([30840])
  })

  it('also adds the file to the folder state when the folder has one', async () => {
    const result = await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, RELAY, token)
    expect(result.ok).toBe(true)
    const [file, command] = sent()
    expect(command.kind).toBe(1852)
    expect(command.tags.find((t) => t[0] === 'h')?.[1]).toBe(TEAM)
    expect(command.tags.find((t) => t[0] === 'op')?.[1]).toBe('add')
    expect(command.tags.find((t) => t[0] === 'a')?.[1]).toBe(`30840:${AUTHOR}:${file.tags[0][1]}`)
  })

  it('reads the accepted field, not the status code', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'restricted: kind not allowed' })
    const result = await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, RELAY, token)
    expect(result).toEqual({ ok: false, reason: 'restricted: kind not allowed' })
    // Refused at the file, so no add was attempted against a file that does not exist.
    expect(sent().map((e) => e.kind)).toEqual([30840])
  })

  it('takes an HTTP refusal of the file as a refusal, and lists nothing', async () => {
    publishSigned.mockResolvedValueOnce({ ok: false, reason: 'auth: payload hash mismatch', httpStatus: 401 })
    const result = await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, RELAY, token)
    expect(result).toEqual({ ok: false, reason: 'auth: payload hash mismatch' })
    expect(sent().map((e) => e.kind)).toEqual([30840])
  })

  it('deletes the saved file by its id when the Folder refuses to list it, and reports the topic as not created', async () => {
    const idOf = (kind: number) => String(kind).padStart(64, 'a')
    signViaEstivaId.mockImplementation(async (event: { kind: number }) => ({ ...event, id: idOf(event.kind), sig: 's' }))
    publishSigned
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'restricted: not a channel member' })
      .mockResolvedValue({ ok: true })
    const result = await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, RELAY, token)
    // `deleted`: its `d` is spent, so starting it again takes a new one.
    expect(result).toEqual({ ok: false, reason: 'restricted: not a channel member', deleted: true })
    const [, , deletion] = sent()
    expect(deletion.kind).toBe(5)
    // By the event, not the address: the same `d` started again is a new version nothing deleted.
    expect(deletion.tags.find((t) => t[0] === 'e')?.[1]).toBe(idOf(30840))
    expect(deletion.tags.some((t) => t[0] === 'a')).toBe(false)
  })

  it('keeps the same d to start again when the deletion is refused too, since the file is still there unlisted', async () => {
    signViaEstivaId.mockImplementation(async (event: { kind: number }) => ({ ...event, id: String(event.kind).padStart(64, 'a'), sig: 's' }))
    publishSigned
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: 'restricted: not a channel member' })
      .mockResolvedValueOnce({ ok: false, reason: 'restricted: not a channel member' })
    const result = await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, RELAY, token)
    expect(result).toEqual({ ok: false, reason: 'restricted: not a channel member' })
    expect(sent().map((e) => e.kind)).toEqual([30840, 1852, 5])
  })
})
