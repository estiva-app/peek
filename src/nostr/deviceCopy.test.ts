/**
 * The copy on the device a reload draws Desk from (PEE-2): what it keeps, what
 * it answers, and that signing out leaves nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memorySnapshotStorage } from '@estiva-app/platform'
import type { SignedEvent } from '@estiva-app/protocol'
import {
  clearDeviceCopy,
  followSignOutElsewhere,
  keepPlaintext,
  keepRelayAnswer,
  plaintextFromCopy,
  readFromCopy,
  resetDeviceCopyForTest,
} from './deviceCopy'
import { rememberRecent, resetRecentsForTests } from '@/lib/recents'

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
/** Moves the fake clock on, letting every timer and promise due by then run. */
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms)
/** Past the idle slot a relay answer is kept in. */
const settle = () => wait(100)

// The page's localStorage, which this environment lacks: where the device remembers whose copy it holds.
const kept = new Map<string, string>()
const pageStorage = {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
}
vi.stubGlobal('localStorage', pageStorage)

/** What the launcher's Recent holds on this device, as a new page would read it. */
const recentOnDevice = () => {
  resetRecentsForTests()
  return JSON.parse(kept.get('estiva-peek:recents') ?? '[]') as unknown[]
}
const openPrivateFile = () =>
  rememberRecent({ kind: 'file', id: `30851:${ME}:private`, title: 'Quarter close', summary: 'Layoffs before Friday', caption: 'Finance' })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
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
    await wait(1_200)
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
    await wait(1_100)

    resetDeviceCopyForTest(storage)
    expect(await readFromCopy(RELAY, [filter], ME)).toEqual([blob])
    expect(plaintextFromCopy('ciphertext')).toBe('{"v":1}')
  })

  it('signing out removes every copy', async () => {
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await wait(1_100)
    expect(storage.records.size).toBe(1)
    await clearDeviceCopy()
    expect(storage.records.size).toBe(0)
    expect(await readFromCopy(RELAY, [filter], ME)).toBeNull()
    // An answer still arriving while the page leaves is not kept.
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await wait(1_200)
    expect(storage.records.size).toBe(0)
  })
})

describe('the launcher’s Recent on the device (SUM-7)', () => {
  // Recent reads the page's storage as `window.localStorage`; only here, since
  // with a `window` the copy would reach for the browser's IndexedDB.
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = { localStorage: pageStorage }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('signing out forgets the files opened, with their summaries and projects (SUM-7)', async () => {
    resetDeviceCopyForTest(memorySnapshotStorage())
    openPrivateFile()
    expect(recentOnDevice()).toHaveLength(1)
    await clearDeviceCopy()
    expect(recentOnDevice()).toEqual([])
  })

  it('somebody else signing in does not see the files the previous person opened (SUM-7)', async () => {
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    expect(await readFromCopy(RELAY, [filter], ME)).toBeNull()
    openPrivateFile()

    resetDeviceCopyForTest(storage) // a new page, signed in as somebody else
    await readFromCopy(RELAY, [filter], SOMEONE)
    expect(recentOnDevice()).toEqual([])
  })
})

describe('the copy on the device, across tabs', () => {

  it('signing out in another tab: this one clears too and keeps nothing more (PEE-3)', async () => {
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await wait(1_100)
    expect(storage.records.size).toBe(1)

    // What the other tab's clearDeviceCopy writes, as this tab's `storage` event sees it.
    followSignOutElsewhere({ key: 'peek-device-copy-owner', newValue: 'signed-out' })
    await wait(0)
    expect(storage.records.size).toBe(0)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await wait(1_200)
    expect(storage.records.size).toBe(0)
  })

  it('another tab opening its copy is not a sign-out', async () => {
    // The control: the owner key also changes when somebody signs in.
    const storage = memorySnapshotStorage()
    resetDeviceCopyForTest(storage)
    keepRelayAnswer(RELAY, [filter], ME, [blob])
    await wait(1_100)
    followSignOutElsewhere({ key: 'peek-device-copy-owner', newValue: 'wss://x|someone' })
    await wait(0)
    expect(storage.records.size).toBe(1)
  })
})
