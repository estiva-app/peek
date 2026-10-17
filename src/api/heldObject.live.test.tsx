/**
 * A widget, or an Activity title, follows its file's field changes while it is
 * drawn: a rename or a move in Ship reaches an open topic in seconds, by asking
 * for that one object again — not after the hold's five minutes, and with no
 * read of the conversation around it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SignedEvent } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }), storedToken: () => ({ accessToken: 't', pubkey: 'v'.repeat(64) }) }))

const relay = vi.hoisted(() => ({
  titles: {} as Record<string, string>,
  unreachable: new Set<string>(),
  resolves: [] as string[],
  joins: [] as { folder: string; kinds: readonly number[]; listener: (event: SignedEvent) => void; left: boolean }[],
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
  joinFolderWatch: (folder: string, kinds: readonly number[], listener: (event: SignedEvent) => void) => {
    const join = { folder, kinds, listener, left: false }
    relay.joins.push(join)
    return () => {
      join.left = true
    }
  },
}))

import { clearListingCaches } from '@/platform/listingCache'
import { useHeldObject, useResolvedReferences } from './foreign'

const OWNER = 'a'.repeat(64)
const ISSUE = `30851:${OWNER}:issue-1`
const OTHER_ISSUE = `30851:${OWNER}:issue-2`
const FOLDER = '22222222-2222-4222-8222-222222222222'

function objectFor(reference: string): ForeignObject {
  return {
    ref: reference,
    address: reference.replace(/^nostr:/, ''),
    eventId: 'e'.repeat(64),
    kind: 30851,
    widget: 'card',
    slots: { title: { value: relay.titles[reference] } },
    meta: [],
    comments: [],
    actions: [],
    folder: FOLDER,
    viaRecommendation: true,
    ...(relay.unreachable.has(reference) ? { unreachable: true } : {}),
  } as unknown as ForeignObject
}

const change = (address: string) =>
  ({ id: 'c'.repeat(64), kind: 1851, tags: [['a', address], ['h', FOLDER]] }) as unknown as SignedEvent

const titleOf = (object: ForeignObject | null | 'loading' | undefined) =>
  object && object !== 'loading' ? object.slots.title?.value : object

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  relay.titles = { [ISSUE]: 'Old title', [OTHER_ISSUE]: 'Another' }
  relay.unreachable.clear()
  relay.resolves = []
  relay.joins = []
  clearListingCaches()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a screen of widgets', () => {
  it('is asked in one read, not one per card (OPT-10)', async () => {
    const batches: string[][] = []
    const nostr = await import('@/nostr/foreign')
    const spy = vi.spyOn(nostr, 'resolveObjectsAsViewer').mockImplementation(async (references) => {
      batches.push([...references])
      return Object.fromEntries(references.map((reference) => [reference, objectFor(reference)]))
    })
    const { result } = renderHook(() => [useHeldObject(ISSUE), useHeldObject(OTHER_ISSUE)])
    await settle()
    expect(batches).toEqual([[ISSUE, OTHER_ISSUE]])
    expect(result.current.map((held) => titleOf(held.object))).toEqual(['Old title', 'Another'])
    spy.mockRestore()
  })
})

describe('a widget follows its file', () => {
  it('joins its file’s Folder for field changes, and draws a rename from one read of that object', async () => {
    const { result } = renderHook(() => useHeldObject(ISSUE))
    await settle()
    expect(titleOf(result.current.object)).toBe('Old title')
    expect(relay.joins.map((j) => [j.folder, j.kinds])).toEqual([[FOLDER, [1851]]])

    relay.titles[ISSUE] = 'New title'
    relay.resolves = []
    act(() => relay.joins[0].listener(change(ISSUE)))
    await settle(300)
    expect(relay.resolves).toEqual([ISSUE])
    expect(titleOf(result.current.object)).toBe('New title')
  })

  it('asks once for changes that land together, and not at all for another file’s', async () => {
    renderHook(() => useHeldObject(ISSUE))
    await settle()
    relay.resolves = []
    act(() => {
      relay.joins[0].listener(change(OTHER_ISSUE))
      relay.joins[0].listener(change(ISSUE))
      relay.joins[0].listener(change(ISSUE))
    })
    await settle(300)
    expect(relay.resolves).toEqual([ISSUE])
  })

  it('asks at most once per 2 s, however many changes name the file — anyone in an open Folder can write them', async () => {
    renderHook(() => useHeldObject(ISSUE))
    await settle()
    relay.resolves = []
    act(() => relay.joins[0].listener(change(ISSUE)))
    await settle(300)
    expect(relay.resolves).toEqual([ISSUE])
    for (let i = 0; i < 6; i++) {
      act(() => relay.joins[0].listener(change(ISSUE)))
      await settle(250)
    }
    expect(relay.resolves).toEqual([ISSUE])
    await settle(1000)
    expect(relay.resolves).toEqual([ISSUE, ISSUE])
  })

  it('a chip and a widget of one file are one object: one follow, one read per change', async () => {
    renderHook(() => useHeldObject(ISSUE))
    renderHook(() => useResolvedReferences([`nostr:${ISSUE}`], { live: true }))
    await settle()
    const open = relay.joins.filter((j) => !j.left)
    expect(open).toHaveLength(1)
    relay.resolves = []
    act(() => open[0].listener(change(ISSUE)))
    await settle(300)
    expect(relay.resolves).toHaveLength(1)
  })

  it('two widgets of one file share one follow, left when the last is gone', async () => {
    const one = renderHook(() => useHeldObject(ISSUE))
    const two = renderHook(() => useHeldObject(ISSUE))
    await settle()
    expect(relay.joins).toHaveLength(1)
    one.unmount()
    expect(relay.joins[0].left).toBe(false)
    two.unmount()
    expect(relay.joins[0].left).toBe(true)
  })

  it('follows nothing for a file the viewer cannot read', async () => {
    relay.unreachable.add(ISSUE)
    renderHook(() => useHeldObject(ISSUE))
    await settle()
    expect(relay.joins).toEqual([])
  })
})

describe('an Activity title follows its file', () => {
  it('follows only when asked to, and draws the held object’s newer answer', async () => {
    const listing = renderHook(() => useResolvedReferences([ISSUE]))
    await settle()
    expect(relay.joins).toEqual([])
    listing.unmount()

    const { result } = renderHook(() => useResolvedReferences([ISSUE], { live: true }))
    await settle()
    expect(result.current[ISSUE]?.slots.title?.value).toBe('Old title')
    expect(relay.joins.map((j) => j.folder)).toEqual([FOLDER])

    relay.titles[ISSUE] = 'New title'
    act(() => relay.joins[0].listener(change(ISSUE)))
    await settle(300)
    expect(result.current[ISSUE]?.slots.title?.value).toBe('New title')
  })
})
