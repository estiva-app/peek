import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEventSnapshot, memorySnapshotStorage, snapshotScope, type LiveClient } from '@estiva-app/platform'
import type { ReconcileOutcome, SignedEvent } from '@estiva-app/protocol'
import { queryRelay, setSocketReader } from './bridge'
import { DEVICE_COPY_VERSION, resetDeviceCopyForTest } from './deviceCopy'
import { forgetRelayInfo } from './relayInfo'
import { createSocketReader } from './socketRead'
import { createFrameShaper, FRAMES_PER_WINDOW, resetSocketFrames } from './socketFrames'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay', hasRelay: true }))

const ME = 'a'.repeat(64)
const ROOM = 'room-1'
const message = (i: number): SignedEvent => ({
  id: i.toString(16).padStart(64, '0'),
  pubkey: ME,
  created_at: 1_000 + i,
  kind: 9,
  tags: [['h', ROOM]],
  content: `m${i}`,
  sig: 'f'.repeat(128),
})

/** A live connection to a relay holding `events`: REQs are answered from them, a catch-up by comparing. */
function liveRelay(events: SignedEvent[]) {
  const reqs: Record<string, unknown>[][] = []
  const client = {
    state: () => 'live',
    onState: () => () => {},
    relay: {
      subscribe(filters: Record<string, unknown>[], onEvent: (event: SignedEvent) => void, options?: { onEose?: () => void }) {
        reqs.push(filters)
        queueMicrotask(() => {
          for (const e of events) if (filters.some((f) => !Array.isArray(f.ids) || f.ids.includes(e.id))) onEvent(e)
          options?.onEose?.()
        })
        return { close: () => {} }
      },
      async reconcile(_filter: Record<string, unknown>, held: readonly { id: string }[]): Promise<ReconcileOutcome> {
        const holds = new Set(held.map((h) => h.id))
        const ids = new Set(events.map((e) => e.id))
        return { ok: true, need: [...ids].filter((id) => !holds.has(id)), have: [...holds].filter((id) => !ids.has(id)) }
      },
    },
  } as unknown as LiveClient
  return { client, reqs }
}

afterEach(() => {
  setSocketReader(null)
  forgetRelayInfo()
  vi.unstubAllGlobals()
  resetSocketFrames()
})

describe('reopening Peek asks the relay only for what changed (THE-6)', () => {
  it('fetches the one message that arrived while Peek was closed, not the room again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ supported_nips: [1, 11, 77] }))))
    const room = [{ kinds: [9], '#h': [ROOM] }]
    const before = Array.from({ length: 30 }, (_, i) => message(i))
    // The copy an earlier visit left on the device.
    const storage = memorySnapshotStorage()
    const earlier = createEventSnapshot({ storage, scope: snapshotScope('https://relay', ME), version: DEVICE_COPY_VERSION })
    await earlier.ready
    earlier.absorb(room, before)
    await earlier.flush()
    resetDeviceCopyForTest(storage)
    const arrived = message(99)
    const { client, reqs } = liveRelay([...before, arrived])
    setSocketReader(
      createSocketReader({
        getClient: () => client,
        currentPubkey: () => ME,
        budget: { noteRateLimited: vi.fn(() => 0), pausedForMs: () => 0 },
        httpBudget: { pausedForMs: () => 0 },
      }),
    )

    const answer = await queryRelay('https://relay', room, 'token', ME)

    expect(reqs).toEqual([[{ ids: [arrived.id] }]])
    expect(answer.ok).toBe(true)
    expect(answer.events).toHaveLength(31)
    expect(answer.events[0].id).toBe(arrived.id)
  })
})

describe('the socket sends a catch-up as the relay meters it (THE-6)', () => {
  it('holds a NEG-OPEN for room like a REQ, but sends its rounds at once past REQs waiting for room', () => {
    vi.useFakeTimers()
    const sent: string[] = []
    const shaper = createFrameShaper((data) => sent.push(data), () => Date.now())
    for (let i = 0; i < FRAMES_PER_WINDOW; i++) shaper.send(`["REQ","r${i}",{}]`)
    shaper.send('["NEG-OPEN","n1",{},"61"]')
    shaper.send('["REQ","later",{}]')
    const before = sent.length
    shaper.send('["NEG-MSG","n0","62"]')
    shaper.send('["NEG-CLOSE","n1"]')
    shaper.send('["NEG-CLOSE","n0"]')

    // The rounds of a catch-up already open go now; a NEG-OPEN waits its turn, and so does the close behind it.
    expect(sent.slice(before)).toEqual(['["NEG-MSG","n0","62"]', '["NEG-CLOSE","n0"]'])
    expect(sent).not.toContain('["NEG-OPEN","n1",{},"61"]')
    vi.advanceTimersByTime(20_000)
    expect(sent.slice(-3)).toEqual(['["NEG-OPEN","n1",{},"61"]', '["REQ","later",{}]', '["NEG-CLOSE","n1"]'])
    vi.useRealTimers()
  })
})
