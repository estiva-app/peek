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

import { createTopicAsViewer } from './foreign'

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

  it('reports a refused add as partial, because the topic does exist', async () => {
    publishSigned.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: 'no' })
    const result = await createTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, RELAY, token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/was created but/)
  })
})
