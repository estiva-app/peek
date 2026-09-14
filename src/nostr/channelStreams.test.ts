import { describe, it, expect, vi } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import {
  CHANNEL_STREAM_LIMIT,
  channelStreamFilters,
  readChannelStreams,
  streamMessagesByFolder,
} from './channelStreams'

const FOLDER_A = '11111111-1111-4111-8111-111111111111'
const FOLDER_B = '22222222-2222-4222-8222-222222222222'
const PK = 'a'.repeat(64)
const ISSUE = `30851:${PK}:one`
const PROJECT = `30850:${PK}:two`

const event = (id: string, tags: string[][], over: Partial<SignedEvent> = {}): SignedEvent => ({
  id: id.padEnd(64, '0'),
  kind: 1111,
  pubkey: PK,
  created_at: 1_000,
  tags,
  content: '',
  sig: '',
  ...over,
})

describe('channelStreamFilters — one filter per Folder, both message kinds', () => {
  it('asks for kind:9 and kind:1111 in each Folder since the horizon', () => {
    expect(channelStreamFilters([FOLDER_A, FOLDER_B], 500)).toEqual([
      { kinds: [9, 1111], '#h': [FOLDER_A], since: 500, limit: CHANNEL_STREAM_LIMIT },
      { kinds: [9, 1111], '#h': [FOLDER_B], since: 500, limit: CHANNEL_STREAM_LIMIT },
    ])
  })
})

describe('streamMessagesByFolder — which Folder, which streams, which thread', () => {
  it('groups by `h` and reads every `a` as a stream the message is in', () => {
    const grouped = streamMessagesByFolder(
      [
        event('1', [['h', FOLDER_A], ['a', ISSUE]]),
        event('2', [['h', FOLDER_B]], { kind: 9 }),
        event('3', [['h', FOLDER_A], ['a', ISSUE], ['a', PROJECT]]),
      ],
      [FOLDER_A, FOLDER_B],
    )
    expect(grouped[FOLDER_A].map((m) => m.about)).toEqual([[ISSUE], [ISSUE, PROJECT]])
    expect(grouped[FOLDER_B].map((m) => m.about)).toEqual([[]])
  })

  it('keeps a quiet Folder as [] and an unasked Folder absent', () => {
    const grouped = streamMessagesByFolder([event('1', [['h', FOLDER_B]])], [FOLDER_A])
    expect(grouped[FOLDER_A]).toEqual([])
    expect(FOLDER_B in grouped).toBe(false)
  })

  it('reads the thread from E, else the first e, else the message is a root', () => {
    const grouped = streamMessagesByFolder(
      [
        event('1', [['h', FOLDER_A]]),
        event('2', [['h', FOLDER_A], ['e', 'r'.repeat(64), '', 'reply']]),
        event('3', [['h', FOLDER_A], ['e', 'r'.repeat(64), '', 'root'], ['e', 'p'.repeat(64), '', 'reply']]),
        event('4', [['h', FOLDER_A], ['E', 'u'.repeat(64)], ['e', 'r'.repeat(64)]]),
      ],
      [FOLDER_A],
    )
    expect(grouped[FOLDER_A].map((m) => m.root)).toEqual([
      '1'.padEnd(64, '0'),
      'r'.repeat(64),
      'r'.repeat(64),
      'u'.repeat(64),
    ])
  })

  it('drops a duplicate the relay answered twice', () => {
    const twice = event('1', [['h', FOLDER_A]])
    expect(streamMessagesByFolder([twice, twice], [FOLDER_A])[FOLDER_A]).toHaveLength(1)
  })
})

describe('readChannelStreams — as few POSTs as the relay allows', () => {
  it('sends one POST for up to 128 Folders and a second for the rest', async () => {
    const folders = Array.from({ length: 130 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
    const query = vi.fn<(filters: Record<string, unknown>[]) => Promise<SignedEvent[]>>(async () => [])
    const grouped = await readChannelStreams(folders, 500, query)
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0][0]).toHaveLength(128)
    expect(query.mock.calls[1][0]).toHaveLength(2)
    expect(Object.keys(grouped)).toHaveLength(130)
  })
})
