import { describe, it, expect } from 'vitest'
import { MAX_BLOB_BYTES } from '@estiva-app/conversation'
import { MAX_PLAINTEXT_BYTES } from './appData'
import { SLOT_STORAGE_KEY, loadSlotIdentity, readStateSlotFilter, rotateSlotId } from './readState'

/**
 * Peek's half of read state (CON-19). The grammar, the cap and the merge are
 * `@estiva-app/conversation`'s and tested there; this is where Peek keeps its
 * slot and what it calls itself.
 */

function memoryStorage(seed?: string): Storage {
  const map = new Map<string, string>()
  if (seed) map.set(SLOT_STORAGE_KEY, seed)
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as unknown as Storage
}

describe('slot identity', () => {
  it('keeps the storage key every existing installation already holds', () => {
    // A new key would mint a new slot for every Peek tab on the next load.
    expect(SLOT_STORAGE_KEY).toBe('estiva-peek:read-state-slot')
  })

  it('mints a 32-hex slot under a peek- client id, and reuses it', () => {
    const storage = memoryStorage()
    const first = loadSlotIdentity(storage)
    expect(first.slotId).toMatch(/^[0-9a-f]{32}$/)
    expect(first.clientId).toMatch(/^peek-[0-9a-f]{8}$/)
    expect(loadSlotIdentity(storage)).toEqual(first)
  })

  it('reads a slot an older Peek stored', () => {
    const stored = { slotId: '0123456789abcdef0123456789abcdef', clientId: 'peek-1a2b3c4d' }
    expect(loadSlotIdentity(memoryStorage(JSON.stringify(stored)))).toEqual(stored)
  })

  it('degrades to an ephemeral slot when storage throws or is absent', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(loadSlotIdentity(throwing).slotId).toMatch(/^[0-9a-f]{32}$/)
    expect(loadSlotIdentity(undefined).slotId).toMatch(/^[0-9a-f]{32}$/)
  })

  it('rotates the slot and keeps the client id', () => {
    const storage = memoryStorage()
    const first = loadSlotIdentity(storage)
    const rotated = rotateSlotId(first, storage)
    expect(rotated.clientId).toBe(first.clientId)
    expect(rotated.slotId).not.toBe(first.slotId)
    expect(loadSlotIdentity(storage)).toEqual(rotated)
  })

  it('filters for its own coordinate only', () => {
    const slot = '0123456789abcdef0123456789abcdef'
    expect(readStateSlotFilter('e'.repeat(64), slot)).toEqual({
      kinds: [30078],
      authors: ['e'.repeat(64)],
      '#d': [`read-state:${slot}`],
    })
  })
})

describe('the ceiling', () => {
  it('is the one the encrypt seam enforces', () => {
    // If these disagree, the blob the queue thinks is safe is the one `/nip44/encrypt` refuses.
    expect(MAX_BLOB_BYTES).toBe(MAX_PLAINTEXT_BYTES)
  })
})
