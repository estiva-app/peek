/*
  A topic started inside a file is stored with that file (SPEC §6.7 "Same
  Folder", record what-belongs-to-a-file-is-stored-with-it) and listed in the
  team whose listing holds the parent, asserted on the events that would reach
  the relay.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'

const { publishSigned, signViaEstivaId } = vi.hoisted(() => ({ publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))
vi.mock('@/nostr/bridge', () => ({ publishSigned, signViaEstivaId, queryRelay: vi.fn() }))
// The new topic is not drawn ahead here (no manifest read): it is written first, as before PEE-6.
vi.mock('@/nostr/foreign', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/nostr/foreign')>()),
  projectOwnFileAsViewer: vi.fn(async () => null),
}))

import { startTopicAsViewer } from './startTopic'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const CHANNEL = '2611db6d-57f0-4f39-a454-a198298b526f'
const PROJECT = `30850:${AUTHOR}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const token = { accessToken: 't', pubkey: AUTHOR } as never

const sent = () => signViaEstivaId.mock.calls.map(([event]) => event as { kind: number; tags: string[][] })
const tag = (event: { tags: string[][] }, name: string) => event.tags.find((t) => t[0] === name)?.[1]

beforeEach(() => {
  publishSigned.mockReset().mockResolvedValue({ ok: true })
  signViaEstivaId.mockReset().mockImplementation(async (event: unknown) => event)
})

describe('a topic started inside a file', () => {
  it('inside a Ship project whose own Folder is its channel: stored there, listed in the team', async () => {
    const project = { address: PROJECT, folder: CHANNEL } as ForeignObject
    const result = await startTopicAsViewer(
      { folder: TEAM, title: 'Launch naming', parent: PROJECT, parentFile: project, hasState: true },
      'https://relay.test',
      token,
    )
    expect(result.ok).toBe(true)
    const [file, listing] = sent()
    expect(file.kind).toBe(30840)
    expect(tag(file, 'h')).toBe(CHANNEL)
    expect(tag(file, 'a')).toBe(PROJECT)
    expect(listing.kind).toBe(1852)
    expect(tag(listing, 'h')).toBe(TEAM)
  })

  it('at the top of a Folder, with no parent: stored and listed in that Folder', async () => {
    await startTopicAsViewer({ folder: TEAM, title: 'T', hasState: true }, 'https://relay.test', token)
    const [file, listing] = sent()
    expect(tag(file, 'h')).toBe(TEAM)
    expect(tag(listing, 'h')).toBe(TEAM)
  })
})
