/**
 * The copy on the device a reload draws Desk from (PEE-2): what it keeps, what
 * it answers, and that signing out leaves nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memorySnapshotStorage } from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'
import {
  clearDeviceCopy,
  keepPlaintext,
  keepRelayAnswer,
  plaintextFromCopy,
  readFromCopy,
  resetDeviceCopyForTest,
} from './deviceCopy'

const RELAY = 'https://relay.test'
const ME = 'a'.repeat(64)
const SOMEONE = 'b'.repeat(64)
const blob: SignedEvent = {
  id: '1'.repeat(64),
  kind: 30078,
  pubkey: ME,
  created_at: 1_800_000_000,
  tags: [['d', 'estiva-peek:open-work:v1']],
  content: 'ciphertext',
  sig: '0'.repeat(128),
}
const filter = { kinds: [30078], authors: [ME], '#d': ['estiva-peek:open-work:v1'] }
/** Past the idle slot a relay answer is kept in. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

// The page's localStorage, which this environment lacks: where the device remembers whose copy it holds.
const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
})

afterEach(() => {
  resetDeviceCopyForTest()
  kept.clear()
})

describe('the copy on the device', () => {
  it('answers a read the relay answered before, and only for that person', async () => {
    resetDeviceCopyForTest(memorySnapshotStorage())
    expect(await readFromCopy(RELAY, [filter], ME)).toBeNull()
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await settle()
    expect(await readFromCopy(RELAY, [filter], ME)).toEqual([blob])
    expect(await readFromCopy(RELAY, [filter], SOMEONE)).toBeNull()
  })

  it('somebody else signing in on this device removes the previous person’s copy first', async () => {
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(storage.records.size).toBe(1)

    resetDeviceCopyForTest(storage) // a new page, signed in as somebody else
    expect(await readFromCopy(RELAY, [filter], SOMEONE)).toBeNull()
    expect(storage.records.size).toBe(0)
  })

  it('survives a reload: a new page reads what the last one kept, plaintext included', async () => {
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await settle()
    keepPlaintext('ciphertext', '{"v":1}')
    // Past the save delay, then the page goes away.
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    resetDeviceCopyForTest(storage)
    expect(await readFromCopy(RELAY, [filter], ME)).toEqual([blob])
    expect(plaintextFromCopy('ciphertext')).toBe('{"v":1}')
  })

  it('signing out removes every copy', async () => {
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    expect(storage.records.size).toBe(1)
    await clearDeviceCopy()
    expect(storage.records.size).toBe(0)
    expect(await readFromCopy(RELAY, [filter], ME)).toBeNull()
    // An answer still arriving while the page leaves is not kept.
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(storage.records.size).toBe(0)
  })
})
