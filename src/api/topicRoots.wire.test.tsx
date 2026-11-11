/**
 * Teams and Topics name each topic you can read, and open none of them
 * (ALO-14): the topics are read as their first records and current fields, not
 * with each one's last 200 comments, the files it lists and the files moved
 * into it. On QA-1's 25 topics those three filters a topic were the 128-filter
 * POSTs Teams' own read waited behind. Counted at the bridge, through the real
 * interop, since a test of the hook's calls would pass whatever went out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { SignedEvent } from '@estiva-app/protocol'

const { queryRelay, readFrom } = vi.hoisted(() => ({ queryRelay: vi.fn(), readFrom: vi.fn() }))
vi.mock('@/nostr/bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))
vi.mock('@/nostr/readFrom', async (original) => ({ ...(await original<typeof import('@/nostr/readFrom')>()), readFrom }))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/heldSession', () => ({ heldToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }) }))

import { useResolvedReferences } from './foreign'

const AUTHOR = 'a'.repeat(64)
const TOPIC = 30840
const FOLDER = 'f0f0f0f0-0000-4000-8000-000000000001'

let seq = 0
const event = (partial: Partial<SignedEvent>): SignedEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: AUTHOR,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  kind: 1,
  ...partial,
})

const topics = ['t0', 't1', 't2'].map((d) => `${TOPIC}:${AUTHOR}:${d}`)
const GONE = `${TOPIC}:${AUTHOR}:gone`
const events = [
  ...topics.map((_, i) => event({ kind: TOPIC, tags: [['d', `t${i}`], ['title', `Topic ${i}`], ['h', FOLDER]] })),
  // A rename, and talk in each topic: the rename is drawn, the talk is not asked for.
  event({ kind: 1851, tags: [['a', topics[0]], ['h', FOLDER], ['field', 'title'], ['value', 'Renamed']] }),
  ...topics.map((address) => event({ kind: 1111, tags: [['A', address], ['a', address], ['h', FOLDER]], content: 'hello' })),
]

/** The relay, matching each filter as buzz does and concatenating the answers. */
function answer(filters: Record<string, unknown>[]): SignedEvent[] {
  return filters.flatMap((f) =>
    events.filter((e) => {
      if (Array.isArray(f.kinds) && !f.kinds.includes(e.kind)) return false
      if (Array.isArray(f.authors) && !f.authors.includes(e.pubkey)) return false
      for (const [key, want] of Object.entries(f)) {
        if (!key.startsWith('#') || !Array.isArray(want)) continue
        const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
        if (!want.some((v) => held.includes(v))) return false
      }
      return true
    }),
  )
}

const sent = () => queryRelay.mock.calls.flatMap(([, filters]) => filters as Record<string, unknown>[])

beforeEach(() => {
  queryRelay.mockReset()
  queryRelay.mockImplementation(async (_url: string, filters: Record<string, unknown>[]) => ({ ok: true, events: answer(filters) }))
  readFrom.mockReset()
  readFrom.mockResolvedValue({ ok: false, events: [] })
})

describe('the topics Teams and Topics name', () => {
  it('are read without their comments, listed files or moved-in files, and drawn with their current title', async () => {
    const { result } = renderHook(() => useResolvedReferences([...topics, GONE], { archivedWith: true, roots: true }))
    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(4))

    const asked = sent()
    const naming = (f: Record<string, unknown>) => [...((f['#a'] as string[]) ?? []), ...((f['#A'] as string[]) ?? [])].some((a) => topics.includes(a))
    expect(asked.filter((f) => naming(f) && (f.kinds as number[]).includes(1111))).toEqual([])
    expect(asked.filter((f) => naming(f) && (f.kinds as number[]).includes(TOPIC))).toEqual([])
    expect(asked.filter((f) => !!f['#A'] && naming(f))).toEqual([])

    expect(result.current[topics[0]]?.slots.title?.value).toBe('Renamed')
    expect(result.current[topics[2]]?.slots.title?.value).toBe('Topic 2')
    // Not handed back (deleted, or in a Folder you cannot read): no row, rather than a row with no title.
    expect(result.current[GONE]).toBeNull()
  })
})
