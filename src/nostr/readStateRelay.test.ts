import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRelay = vi.fn()
const decryptBlob = vi.fn()
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))
vi.mock('./appData', () => ({ decryptBlob, encryptBlob: vi.fn() }))

const { fetchOwnSlot, loadMergedReadState } = await import('./readStateRelay')

const PUBKEY = 'e'.repeat(64)
const SLOT = '0123456789abcdef0123456789abcdef'
const seam = { relayUrl: 'wss://relay.test', accessToken: 'token', pubkey: PUBKEY }
const FILE = `30851:${PUBKEY}:issue`
const slotEvent = (slot: string, created_at: number) => ({
  id: slot.padEnd(64, '0'),
  pubkey: PUBKEY,
  kind: 30078,
  created_at,
  tags: [['d', `read-state:${slot}`], ['t', 'read-state']],
  content: `cipher-${slot}`,
  sig: '',
})
const blob = (clientId: string, contexts: Record<string, number>) => JSON.stringify({ v: 1, client_id: clientId, contexts })

beforeEach(() => {
  queryRelay.mockReset()
  decryptBlob.mockReset()
})

describe('fetchOwnSlot', () => {
  it('reads an empty coordinate as empty', async () => {
    queryRelay.mockResolvedValue({ ok: true, events: [] })
    expect(await fetchOwnSlot(seam, SLOT)).toEqual({ reachable: true })
  })

  it('does not read a coordinate it cannot decrypt as empty', async () => {
    // A 429 from /nip44/decrypt: "empty" here would let the next publish replace the slot.
    queryRelay.mockResolvedValue({ ok: true, events: [slotEvent(SLOT, 100)] })
    decryptBlob.mockResolvedValue(undefined)
    expect(await fetchOwnSlot(seam, SLOT)).toEqual({ reachable: false })
  })

  it('returns the blob it decrypts', async () => {
    queryRelay.mockResolvedValue({ ok: true, events: [slotEvent(SLOT, 100)] })
    decryptBlob.mockResolvedValue(blob('peek-1a2b3c4d', { [FILE]: 50 }))
    expect((await fetchOwnSlot(seam, SLOT)).blob?.contexts).toEqual({ [FILE]: 50 })
  })
})

describe('loadMergedReadState', () => {
  const identity = { slotId: SLOT, clientId: 'peek-1a2b3c4d' }

  it('merges every slot by maximum, skipping one it cannot decrypt', async () => {
    const other = 'f'.repeat(32)
    const lost = 'a'.repeat(32)
    queryRelay.mockResolvedValue({ ok: true, events: [slotEvent(SLOT, 100), slotEvent(other, 90), slotEvent(lost, 80)] })
    decryptBlob.mockImplementation(async (c: string) =>
      c === `cipher-${SLOT}` ? blob('peek-1a2b3c4d', { [FILE]: 50 }) : c === `cipher-${other}` ? blob('ship-0000aaaa', { [FILE]: 70 }) : undefined,
    )
    const state = await loadMergedReadState(seam, identity, 1_000_000)
    expect(state?.merged).toEqual({ [FILE]: 70 })
    expect(state?.verdict.mine?.dTag).toBe(`read-state:${SLOT}`)
    expect(state?.verdict.coordinateConflicted).toBe(false)
  })

  it('answers undefined, not "read nothing", when the relay cannot be asked', async () => {
    queryRelay.mockResolvedValue({ ok: false, events: [] })
    expect(await loadMergedReadState(seam, identity, 1_000_000)).toBeUndefined()
  })
})
