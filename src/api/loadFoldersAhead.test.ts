/**
 * The Desk reads the Folder listing and then the Folders Topics opens with,
 * ahead of Topics (PEE-5) — one load, so each file's changes come from the
 * relay once (APP-2). Both reads ask for every change naming every listed
 * file; through separate queries, each change was sent twice.
 *
 * The relay is faked at the bridge, answering each filter in full, newest
 * first, up to its limit, as production does: an event two filters match is
 * sent twice. It counts what it sends, because the listing was already right.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string; sig: string }

const { queryRelay, events, sent } = vi.hoisted(() => {
  const events: Event[] = []
  const sent: Event[] = []
  const matches = (event: Event, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, wanted]) => {
      if (key === 'limit' || key === 'since' || key === 'until' || key === 'search') return true
      const values = wanted as (string | number)[]
      if (key === 'kinds') return values.includes(event.kind)
      if (key === 'authors') return values.includes(event.pubkey)
      if (key === 'ids') return values.includes(event.id)
      if (key.startsWith('#')) return event.tags.some((t) => t[0] === key.slice(1) && values.includes(t[1]))
      return true
    })
  const queryRelay = vi.fn(async (_url: string, filters: Record<string, unknown>[]) => {
    const out = filters.flatMap((filter) =>
      events
        .filter((event) => matches(event, filter))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, (filter.limit as number | undefined) ?? Infinity),
    )
    sent.push(...out)
    return { ok: true, events: out }
  })
  return { queryRelay, events, sent }
})
vi.mock('@/nostr/bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { topLevelFolders } from '@estiva-app/interop'
import { clearFolderListing, listedFile, loadFoldersAhead } from './useFolderContents'

const KEEPER = 'a'.repeat(64)
const RELAY = 'f'.repeat(64)
const APIARY = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const ORCHARD = '05bebd5b-b699-4bd4-af50-f5377df0fd67'
const HIVE = 30871
const at = { relayUrl: 'https://relay.test', token: { accessToken: 't', pubkey: KEEPER } as never }

let seq = 0
const event = (partial: Partial<Event>): Event => ({
  id: String(++seq).padStart(64, '0'),
  kind: 1,
  pubkey: KEEPER,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  sig: '',
  ...partial,
})
const addressOf = (e: Event) => `${e.kind}:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')![1]}`

/** An app nobody wrote: its hives are files with a status, changed by SPEC's change kind. */
const hiveLog = event({
  kind: 31990,
  tags: [['d', 'hive-log'], ['k', String(HIVE)]],
  content: JSON.stringify({
    name: 'Hive log',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value', order: ['ts', 'created_at', 'id'], rule: 'last-write-wins-per-field' },
    projections: { [HIVE]: { widget: 'card', slots: { title: { tag: 'title' }, status: { fold: 'status' } } } },
  }),
})
const channelOf = (id: string, name: string) => event({ kind: 39000, pubkey: RELAY, tags: [['d', id], ['name', name]] })
const stateOf = (id: string, name: string, files: Event[]) =>
  event({ kind: 30890, pubkey: RELAY, tags: [['d', id], ['name', name], ...files.map((f) => ['a', addressOf(f)])] })
const hive = (d: string, folder: string) => event({ kind: HIVE, tags: [['d', d], ['title', `${d} hive`], ['h', folder]] })
const change = (file: Event, field: string, value: string, folder: string) =>
  event({ kind: 1851, tags: [['a', addressOf(file)], ['field', field], ['value', value], ['h', folder]] })

const north = hive('north', APIARY)
const south = hive('south', APIARY)
const pear = hive('pear', ORCHARD)
const changes = [
  change(north, 'status', 'queen seen', APIARY),
  change(north, 'status', 'swarming', APIARY),
  change(south, 'status', 'quiet', APIARY),
  change(south, 'archived', 'true', APIARY),
  change(pear, 'status', 'in bloom', ORCHARD),
]

beforeEach(() => {
  clearFolderListing()
  sent.length = 0
  events.length = 0
  events.push(
    hiveLog,
    channelOf(APIARY, 'Apiary'),
    channelOf(ORCHARD, 'Orchard'),
    stateOf(APIARY, 'Apiary', [north, south]),
    stateOf(ORCHARD, 'Orchard', [pear]),
    north,
    south,
    pear,
    ...changes,
  )
})

describe('the Desk reads Folders ahead as one load (APP-2)', () => {
  it('gets each file change from the relay once across the listing and the Folders it reads', async () => {
    await loadFoldersAhead(at, async (folders) => topLevelFolders([...folders]))
    for (const c of changes) expect(sent.filter((s) => s.id === c.id), `change to ${c.tags[0][1]}, ${c.tags[1][1]}`).toHaveLength(1)
  })

  it('still lists each Folder’s live files with their latest fields, and leaves the archived one out', async () => {
    const folders = await loadFoldersAhead(at, async (listed) => topLevelFolders([...listed]))
    expect(folders.map((folder) => folder.name).sort()).toEqual(['Apiary', 'Orchard'])
    expect(listedFile(addressOf(north))?.slots.status?.value).toBe('swarming')
    expect(listedFile(addressOf(pear))?.slots.status?.value).toBe('in bloom')
    expect(listedFile(addressOf(south))).toBeUndefined()
  })
})
