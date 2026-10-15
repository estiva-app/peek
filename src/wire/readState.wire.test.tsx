/**
 * Read state, at the wire (UNI-7): what reaches the relay when a person reads
 * a file, a thread or a Folder's talk, through the same calls the views make
 * (`record*Read`, then the queue's flush) with `<ReadStateSync/>` mounted as
 * the app mounts it. The `kind:30078` slot is read back off the fake relay and
 * its blob decrypted, so these fail on what the relay would store — a context
 * missing, one advanced that was not read, a slot that drops what it held.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { installWireRelay, ME, tagOf, type WireRelay } from '@/test/wireRelay'
import {
  ReadStateSync,
  flushReadState,
  recordContainerRead,
  recordFileRead,
  recordThreadRead,
  resetReadStateQueueForTests,
} from '@/nostr/useReadStateSync'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))

const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const ISSUE = `30851:${'a'.repeat(64)}:b1bab6ee-47e6-4737-b384-9904a311122a`
const ROOT = 'e'.repeat(64)
const AT = 1_760_000_000_000

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  resetReadStateQueueForTests()
  window.localStorage.clear()
})
afterAll(() => vi.unstubAllGlobals())

/** Mount the sync as a tab does, record, and flush; returns what the relay holds for this slot. */
async function readAndFlush(record: () => void) {
  const view = render(<ReadStateSync />)
  record()
  await flushReadState()
  view.unmount()
}

const slots = () => relay.sentOf(30078)
const blobOf = (event: { content: string }) =>
  JSON.parse(relay.decrypt(event.content)) as { v: number; client_id: string; contexts: Record<string, number> }

describe('read state at the wire', () => {
  it('a file, a thread and a Folder read go out as one encrypted 30078 slot, each under its own context', async () => {
    await readAndFlush(() => {
      recordFileRead(ISSUE, AT)
      recordThreadRead(ROOT, AT + 1_000)
      recordContainerRead(FOLDER, AT + 2_000)
    })

    expect(slots()).toHaveLength(1)
    const [slot] = slots()
    expect(slot.pubkey).toBe(ME)
    expect(tagOf(slot, 't')).toBe('read-state')
    expect(tagOf(slot, 'd')).toMatch(/^read-state:[0-9a-f]{32}$/)
    expect(slot.content).not.toContain(ISSUE)
    const blob = blobOf(slot)
    expect(blob.v).toBe(1)
    expect(blob.contexts).toEqual({
      [ISSUE]: AT / 1000,
      [`thread:${ROOT}`]: AT / 1000 + 1,
      [FOLDER]: AT / 1000 + 2,
    })
  })

  it('reading a thread or a file does not mark the Folder’s talk read (SPEC §11.2)', async () => {
    await readAndFlush(() => {
      recordThreadRead(ROOT, AT)
      recordFileRead(ISSUE, AT)
    })
    expect(Object.keys(blobOf(slots()[0]).contexts).sort()).toEqual([ISSUE, `thread:${ROOT}`].sort())
  })

  it('a later visit adds to what the slot holds on the relay rather than replacing it', async () => {
    await readAndFlush(() => recordFileRead(ISSUE, AT))
    const first = slots()[0]

    // A reload: the tab's queue is new, the slot on the relay is the only memory.
    resetReadStateQueueForTests()
    await readAndFlush(() => recordContainerRead(FOLDER, AT + 5_000))

    expect(slots()).toHaveLength(2)
    const second = slots()[1]
    expect(tagOf(second, 'd')).toBe(tagOf(first, 'd'))
    expect(blobOf(second).contexts).toEqual({ [ISSUE]: AT / 1000, [FOLDER]: AT / 1000 + 5 })
  })

  it('an older read of the same thing does not move its marker back', async () => {
    await readAndFlush(() => recordFileRead(ISSUE, AT + 9_000))
    resetReadStateQueueForTests()
    await readAndFlush(() => recordFileRead(ISSUE, AT))
    const last = slots().at(-1)!
    expect(blobOf(last).contexts[ISSUE]).toBe(AT / 1000 + 9)
  })

  it('a slot the relay refuses is sent again on the next flush, with every marker it held', async () => {
    relay.refuse({ when: (event) => event.kind === 30078, times: 1, message: 'rate-limited: slow down' })
    const view = render(<ReadStateSync />)
    recordFileRead(ISSUE, AT)
    recordContainerRead(FOLDER, AT)
    await flushReadState()
    recordThreadRead(ROOT, AT)
    await flushReadState()
    view.unmount()

    expect(slots()).toHaveLength(2)
    expect(Object.keys(blobOf(slots()[1]).contexts).sort()).toEqual([ISSUE, FOLDER, `thread:${ROOT}`].sort())
  })
})
