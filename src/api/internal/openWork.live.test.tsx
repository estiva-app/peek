/**
 * A file in Open work shows its current title (PEE-28): a rename made by
 * somebody else, in another tab or in Ship reaches the Desk row in seconds,
 * from one read of that file — the way a widget follows its file — not on
 * the next reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { SignedEvent } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }), storedToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }) }))

const OWNER = 'a'.repeat(64)
const TOPIC = `30840:${OWNER}:topic-1`
const FOLDER = '22222222-2222-4222-8222-222222222222'

const relay = vi.hoisted(() => ({
  titles: {} as Record<string, string>,
  resolves: [] as string[],
  joins: [] as { folder: string; listener: (event: SignedEvent) => void; left: boolean }[],
}))
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  resolveObjectAsViewer: async (reference: string) => {
    relay.resolves.push(reference)
    return objectFor(reference)
  },
  resolveObjectsAsViewer: async (references: string[]) => {
    relay.resolves.push(...references)
    return Object.fromEntries(references.map((reference) => [reference, objectFor(reference)]))
  },
}))
vi.mock('@/nostr/useLiveFile', () => ({
  joinFolderWatch: (folder: string, _kinds: readonly number[], listener: (event: SignedEvent) => void) => {
    const join = { folder, listener, left: false }
    relay.joins.push(join)
    return () => {
      join.left = true
    }
  },
}))
vi.mock('@/api/people', async (importOriginal) => ({
  isPersonKey: (await importOriginal<typeof import('@/api/people')>()).isPersonKey,
  useWorkspacePeople: () => [],
}))
vi.mock('@/nostr/useOpenWorkSync', () => ({
  useOpenWorkSync: () => ({
    state: 'present',
    relayBlob: { v: 1, updatedAt: 1_787_142_018_561, entries: [{ kind: 'file', address: TOPIC }] },
    cachedBlob: undefined,
    publish: async () => undefined,
  }),
}))

import { clearListingCaches } from '@/platform/listingCache'
import { OpenWorkProvider, useOpenWork } from './openWork'

function objectFor(reference: string): ForeignObject {
  return {
    ref: reference,
    address: reference,
    eventId: 'e'.repeat(64),
    kind: 30840,
    widget: 'card',
    slots: { title: { value: relay.titles[reference] } },
    meta: [],
    comments: [],
    actions: [],
    folder: FOLDER,
    viaRecommendation: true,
  } as unknown as ForeignObject
}

/** A `kind:1851` title change to the topic, as it arrives on the Folder's watch. */
const renamed = () => ({ id: 'c'.repeat(64), kind: 1851, tags: [['a', TOPIC], ['h', FOLDER]] }) as unknown as SignedEvent

const titles = (items: ReturnType<typeof useOpenWork>['items']) => items.map((item) => (item.kind === 'file' ? item.title : item.name))

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  relay.titles = { [TOPIC]: 'Planning' }
  relay.resolves = []
  relay.joins = []
  clearListingCaches()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Open work follows its files (PEE-28)', () => {
  it('draws a rename made elsewhere without a reload, from one read of that file', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <OpenWorkProvider>{children}</OpenWorkProvider>
    const { result } = renderHook(() => useOpenWork(), { wrapper })
    await settle()
    expect(titles(result.current.items)).toEqual(['Planning'])

    relay.titles[TOPIC] = 'Planning and sequencing'
    relay.resolves = []
    act(() => relay.joins.filter((j) => j.folder === FOLDER && !j.left).forEach((j) => j.listener(renamed())))
    await settle(300)
    expect(relay.resolves).toEqual([TOPIC])
    expect(titles(result.current.items)).toEqual(['Planning and sequencing'])
  })

  it('stops following when Open work is gone', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <OpenWorkProvider>{children}</OpenWorkProvider>
    const { unmount } = renderHook(() => useOpenWork(), { wrapper })
    await settle()
    expect(relay.joins.map((j) => [j.folder, j.left])).toEqual([[FOLDER, false]])
    unmount()
    expect(relay.joins.map((j) => [j.folder, j.left])).toEqual([[FOLDER, true]])
  })
})
