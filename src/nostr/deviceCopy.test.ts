/**
 * The copy on the device a reload draws Desk from (PEE-2): what it keeps, what
 * it answers, and that signing out leaves nothing.
 */
import { afterEach, describe, expect, it } from 'vitest'
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => resetDeviceCopyForTest())

describe('the copy on the device', () => {
  it('answers a read the relay answered before, and only for that person', async () => {
    resetDeviceCopyForTest(memorySnapshotStorage())
    expect(await readFromCopy(RELAY, [filter], ME)).toBeNull()
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await settle()
    expect(await readFromCopy(RELAY, [filter], ME)).toEqual([blob])
    expect(await readFromCopy(RELAY, [filter], SOMEONE)).toBeNull()
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
  })
})
