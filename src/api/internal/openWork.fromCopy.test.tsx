/**
 * A reopen's Open work draws from the copy on the device while the relay catches up (aec00dfc).
 *
 * Under the relay's quota its answer comes 5–7 s into a reopen, and Open work used to read "Organize what you want to
 * read…" until then: every file read it made was the open read (`text`), which the copy never answers. These run the
 * real interop and the copy's own rule (`answerFromCopy`), with the relay and the copy's store faked, so a read the
 * copy cannot answer fails here as it does on a reopen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SignedEvent } from '@estiva-app/protocol'

const AUTHOR = 'a'.repeat(64)
const VIEWER = 'v'.repeat(64)
const ISSUE = 30851

const { queryRelay, readFrom, relay } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  readFrom: vi.fn(),
  relay: { answered: undefined as undefined | (() => void) },
}))
vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  validToken: () => ({ accessToken: 't', pubkey: VIEWER }),
  storedToken: () => ({ accessToken: 't', pubkey: VIEWER }),
}))
// The relay's times read (a deleted file's changes): no times, as for a file nobody changed.
vi.mock('@/nostr/bridge', async (original) => ({ ...(await original<Record<string, unknown>>()), queryRelay, queryRelayTimes: async () => [] }))
vi.mock('@/nostr/readFrom', async (original) => ({ ...(await original<typeof import('@/nostr/readFrom')>()), readFrom }))
vi.mock('@/nostr/useLiveFile', () => ({ joinFolderWatch: () => () => {} }))
vi.mock('@/api/people', async (importOriginal) => ({
  isPersonKey: (await importOriginal<typeof import('@/api/people')>()).isPersonKey,
  useWorkspacePeople: () => [],
}))
const address = (d: string) => `${ISSUE}:${AUTHOR}:${d}`
const [HELD, NEW] = [address('f-held'), address('f-added')]
let listed: string[] = []
vi.mock('@/nostr/useOpenWorkSync', () => ({
  useOpenWorkSync: () => ({
    state: 'present',
    relayBlob: { v: 1, updatedAt: 1_787_142_018_561, entries: listed.map((a) => ({ kind: 'file', address: a })) },
    cachedBlob: undefined,
    publish: async () => undefined,
  }),
}))

import { answerFromCopy } from '@/nostr/deviceCopy'
import { forgetUrlShapes } from '@/nostr/foreign'
import { clearListingCaches } from '@/platform/listingCache'
import { relayAnswer } from '@/test/listRead'
import { OpenWorkProvider, useOpenWork } from './openWork'

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
const manifest = event({
  kind: 31990,
  tags: [['d', 'ship'], ['k', String(ISSUE)]],
  content: JSON.stringify({ name: 'Ship', projections: { [ISSUE]: { widget: 'row', slots: { title: { tag: 'title' } } } } }),
})
const file = (d: string, title: string) => event({ kind: ISSUE, tags: [['d', d], ['title', title]], content: `${title}'s text` })
/** What the relay holds now: the file this device read before, and one added since on another device. */
const onRelay = [manifest, file('f-held', 'Quota wait'), file('f-added', 'Positioning')]
/** What the copy kept from the last visit: the relay's answers then, which never named the file added since. */
const inCopy = [manifest, onRelay[1]]

/** The copy on the device, answering as `answerFromCopy` does: an open read (`text`) it never answers. */
type Filter = Parameters<typeof relayAnswer>[1][number]
const copy = { answer: (filters: Filter[]) => relayAnswer(inCopy, filters), held: (list: Filter) => relayAnswer(inCopy, [list]) }
const fromCopy = async (_source: string, _url: string, filters: Record<string, unknown>[]) => {
  // A read naming a file the copy never saw is one it cannot answer, as the copy refuses any read it never kept.
  if (JSON.stringify(filters).includes(NEW.split(':')[2])) return { ok: false, events: [] }
  const events = answerFromCopy(copy as never, filters)
  return events ? { ok: true, events } : { ok: false, events: [] }
}

const rows = (items: ReturnType<typeof useOpenWork>['items']) =>
  items.map((item) => (item.kind === 'file' ? item.title : item.kind === 'loading' ? `loading ${item.address.split(':')[2]}` : item.kind))

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function render() {
  const wrapper = ({ children }: { children: ReactNode }) => <OpenWorkProvider>{children}</OpenWorkProvider>
  return renderHook(() => useOpenWork(), { wrapper })
}

beforeEach(() => {
  vi.useFakeTimers()
  forgetUrlShapes()
  clearListingCaches()
  readFrom.mockReset()
  readFrom.mockImplementation(fromCopy)
  // The relay under its quota: no answer until the test lets it give one.
  queryRelay.mockReset()
  // Once it answers, it answers every read after it at once.
  let open = false
  const waiting: (() => void)[] = []
  queryRelay.mockImplementation(
    (_url: string, filters: Record<string, unknown>[]) =>
      new Promise((resolve) => {
        const answer = () => resolve({ ok: true, events: relayAnswer(onRelay, filters as never) })
        if (open) answer()
        else waiting.push(answer)
      }),
  )
  relay.answered = () => {
    open = true
    waiting.splice(0).forEach((answer) => answer())
  }
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Open work on a reopen, while the relay catches up (aec00dfc)', () => {
  it('draws a file the copy holds before the relay answers', async () => {
    listed = [HELD]
    const { result } = render()
    await settle(100)
    expect(rows(result.current.items)).toEqual(['Quota wait'])
  })

  it('holds a placeholder for a file the copy has never seen, and the relay’s answer turns it into the file', async () => {
    listed = [HELD, NEW]
    const { result } = render()
    await settle(3_000)
    // Past the Desk's wait for its files: still never empty while it has entries.
    expect(rows(result.current.items)).toEqual(['Quota wait', 'loading f-added'])

    relay.answered?.()
    await settle(100)
    expect(rows(result.current.items)).toEqual(['Quota wait', 'Positioning'])
  })

  it('keeps the rows the copy drew when the relay refuses the read', async () => {
    queryRelay.mockImplementation(async () => ({ ok: false, reason: 'rate-limited: quota exceeded', events: [] }))
    listed = [HELD]
    const { result } = render()
    await settle(3_000)
    expect(rows(result.current.items)).toEqual(['Quota wait'])
  })
})
