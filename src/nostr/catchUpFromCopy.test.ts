import { describe, expect, it, vi } from 'vitest'
import { createEventSnapshot, matchesSnapshotFilter, memorySnapshotStorage, type SnapshotFilter } from '@estiva-app/platform'
import type { ReconcileOutcome, SignedEvent } from '@estiva-app/protocol'
import { catchUpFromCopy } from './catchUpFromCopy'

const ME = 'a'.repeat(64)
let n = 0
function event(kind: number, tags: string[][], created_at: number): SignedEvent {
  n += 1
  return { id: n.toString(16).padStart(64, '0'), pubkey: ME, created_at, kind, tags, content: `e${n}`, sig: 'f'.repeat(128) }
}

const newestFirst = (a: SignedEvent, b: SignedEvent) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)
/** What a filter matches: a list read (`fields`) answers its first records, which here have no changes. */
const without = ({ limit: _limit, fields: _fields, ...rest }: Record<string, unknown>) => rest as SnapshotFilter

/** A relay holding `events`: it answers a plain read, and a catch-up by comparing what the copy holds. */
function fakeRelay(events: SignedEvent[]) {
  const plain: Record<string, unknown>[][] = []
  const reconciled: SnapshotFilter[] = []
  const answer = (filters: Record<string, unknown>[]) => {
    const out = new Map<string, SignedEvent>()
    for (const filter of filters) {
      const matched = events.filter((e) => matchesSnapshotFilter(without(filter), e)).sort(newestFirst)
      for (const e of typeof filter.limit === 'number' ? matched.slice(0, filter.limit) : matched) out.set(e.id, e)
    }
    return [...out.values()]
  }
  return {
    plain,
    reconciled,
    /** Plain reads that were not a fetch by id. */
    asked: () => plain.filter((filters) => !filters.every((f) => 'ids' in f)),
    fetchedIds: () => plain.filter((filters) => filters.every((f) => 'ids' in f)).flatMap((filters) => filters.flatMap((f) => f.ids as string[])),
    ask: vi.fn(async (filters: Record<string, unknown>[]) => {
      plain.push(filters)
      return { ok: true, events: answer(filters) }
    }),
    reconcile: vi.fn(async (filter: SnapshotFilter, held: readonly { id: string }[]): Promise<ReconcileOutcome> => {
      reconciled.push(filter)
      const set = new Set(events.filter((e) => matchesSnapshotFilter(without(filter), e)).map((e) => e.id))
      const holds = new Set(held.map((h) => h.id))
      return { ok: true, need: [...set].filter((id) => !holds.has(id)), have: [...holds].filter((id) => !set.has(id)) }
    }),
  }
}

async function copyHolding(filters: Record<string, unknown>[], events: SignedEvent[]) {
  const copy = createEventSnapshot({ storage: memorySnapshotStorage(), scope: 'test', version: 1 })
  await copy.ready
  copy.absorb(filters as SnapshotFilter[], events)
  return copy
}

const options = (relay: ReturnType<typeof fakeRelay>, keep = vi.fn()) => ({
  relayUrl: 'wss://relay',
  speaksNip77: () => true,
  reconcile: relay.reconcile,
  ask: relay.ask,
  keep,
})

describe('a reopen catches a question up from the copy (THE-6)', () => {
  const room = 'room-1'
  const asked = [{ kinds: [9], '#h': [room] }]

  it('downloads only the message that arrived while Peek was closed, and answers the whole room', async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding(asked, before)
    const arrived = event(9, [['h', room]], 2_000)
    const relay = fakeRelay([...before, arrived])

    const answer = await catchUpFromCopy(copy, asked, options(relay))

    expect(relay.asked()).toEqual([])
    expect(relay.fetchedIds()).toEqual([arrived.id])
    expect(answer?.ok).toBe(true)
    expect(answer?.events.map((e) => e.id)).toEqual([arrived, ...before.slice().reverse()].map((e) => e.id))
  })

  it('leaves out a message deleted while Peek was closed, and the copy no longer holds it', async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding(asked, before)
    const [deleted, ...kept] = before
    const relay = fakeRelay(kept)

    const answer = await catchUpFromCopy(copy, asked, options(relay))

    expect(answer?.events.map((e) => e.id)).not.toContain(deleted.id)
    expect(answer?.events).toHaveLength(19)
    expect(copy.held(asked[0] as SnapshotFilter)?.map((e) => e.id)).not.toContain(deleted.id)
  })

  it('drops a whole team the person can no longer read', async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding(asked, before)
    const relay = fakeRelay([])

    const answer = await catchUpFromCopy(copy, asked, options(relay))

    expect(answer).toEqual({ ok: true, events: [] })
    expect(copy.held(asked[0] as SnapshotFilter)).toEqual([])
  })

  it("catches up a hundred files' comments as one question, each still answered to its own limit", async () => {
    const files = Array.from({ length: 100 }, (_, i) => `30851:${ME}:issue-${i}`)
    const perFile = files.map((a) => ({ kinds: [1111], '#a': [a], limit: 200 }))
    const comments = files.flatMap((a, i) => [event(1111, [['a', a]], 1_000 + i), event(1111, [['a', a]], 1_500 + i)])
    const copy = await copyHolding(perFile, comments)
    const fresh = event(1111, [['a', files[7]]], 3_000)
    const relay = fakeRelay([...comments, fresh])

    const answer = await catchUpFromCopy(copy, perFile, options(relay))

    expect(relay.reconcile).toHaveBeenCalledTimes(1)
    expect(relay.reconciled[0]['#a']).toHaveLength(100)
    expect(relay.asked()).toEqual([])
    expect(relay.fetchedIds()).toEqual([fresh.id])
    expect(answer?.events).toHaveLength(201)
  })

  it("answers each packed file only its newest events up to its limit when one grew past it while away", async () => {
    const files = [`30851:${ME}:one`, `30851:${ME}:two`]
    const perFile = files.map((a) => ({ kinds: [1111], '#a': [a], limit: 10 }))
    const held = files.flatMap((a) => Array.from({ length: 9 }, (_, i) => event(1111, [['a', a]], 1_000 + i)))
    const copy = await copyHolding(perFile, held)
    const flood = Array.from({ length: 5 }, (_, i) => event(1111, [['a', files[0]]], 2_000 + i))
    const relay = fakeRelay([...held, ...flood])

    const answer = await catchUpFromCopy(copy, perFile, options(relay))

    const first = answer!.events.filter((e) => e.tags[0][1] === files[0])
    expect(first).toHaveLength(10)
    expect(first.slice(0, 5).map((e) => e.id)).toEqual(flood.slice().reverse().map((e) => e.id))
    expect(answer!.events.filter((e) => e.tags[0][1] === files[1])).toHaveLength(9)
  })

  it('asks a packed file that grew by hundreds while away by its window, never downloading all of it', async () => {
    const files = [`30851:${ME}:one`, `30851:${ME}:two`]
    const perFile = files.map((a) => ({ kinds: [1111], '#a': [a], limit: 10 }))
    const held = files.flatMap((a) => Array.from({ length: 9 }, (_, i) => event(1111, [['a', a]], 1_000 + i)))
    const copy = await copyHolding(perFile, held)
    const flood = Array.from({ length: 500 }, (_, i) => event(1111, [['a', files[0]]], 2_000 + i))
    const relay = fakeRelay([...held, ...flood])

    const answer = await catchUpFromCopy(copy, perFile, options(relay))

    expect(relay.fetchedIds()).toEqual([])
    const first = answer!.events.filter((e) => e.tags[0][1] === files[0])
    expect(first.map((e) => e.id)).toEqual(flood.slice(-10).reverse().map((e) => e.id))
    expect(answer!.events.filter((e) => e.tags[0][1] === files[1])).toHaveLength(9)
  })

  it('asks a question the copy holds too little of as before, beside the catch-up, and keeps its answer', async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const profile = { kinds: [0], authors: [ME] }
    const copy = await copyHolding(asked, before)
    const relay = fakeRelay([...before, event(0, [], 500)])
    const keep = vi.fn()

    const answer = await catchUpFromCopy(copy, [...asked, profile], options(relay, keep))

    expect(relay.asked()).toEqual([[profile]])
    expect(keep).toHaveBeenCalledWith([profile], [expect.objectContaining({ kind: 0 })])
    expect(answer?.events).toHaveLength(21)
  })

  describe("the workspace's project list (SPEC §6.13), which lists each team's projects (THE-11)", () => {
    const projectList = { fields: 'newest', kinds: [30850] }
    const project = (i: number, at: number) => event(30850, [['d', `p${i}`], ['buzz-channel', `team-${i % 3}`]], at)

    it('downloads none of it again on a reopen with nothing new, and answers every project', async () => {
      const projects = Array.from({ length: 20 }, (_, i) => project(i, 1_000 + i))
      const copy = await copyHolding([projectList], projects)
      const relay = fakeRelay(projects)

      const answer = await catchUpFromCopy(copy, [projectList], options(relay))

      expect(relay.asked()).toEqual([])
      expect(relay.fetchedIds()).toEqual([])
      expect(relay.reconciled).toEqual([projectList])
      expect(answer?.events.map((e) => e.id).sort()).toEqual(projects.map((e) => e.id).sort())
    })

    it('downloads only a project made while Peek was closed, and lists it with the rest', async () => {
      const projects = Array.from({ length: 20 }, (_, i) => project(i, 1_000 + i))
      const copy = await copyHolding([projectList], projects)
      const made = project(20, 2_000)
      const relay = fakeRelay([...projects, made])

      const answer = await catchUpFromCopy(copy, [projectList], options(relay))

      expect(relay.asked()).toEqual([])
      expect(relay.fetchedIds()).toEqual([made.id])
      expect(answer?.events.map((e) => e.id)).toContain(made.id)
      expect(answer?.events).toHaveLength(21)
    })

    it('leaves out a project deleted while Peek was closed', async () => {
      const projects = Array.from({ length: 20 }, (_, i) => project(i, 1_000 + i))
      const copy = await copyHolding([projectList], projects)
      const [gone, ...kept] = projects
      const relay = fakeRelay(kept)

      const answer = await catchUpFromCopy(copy, [projectList], options(relay))

      expect(relay.asked()).toEqual([])
      expect(answer?.events.map((e) => e.id)).not.toContain(gone.id)
      expect(answer?.events).toHaveLength(19)
    })

    it("catches each team's file list up as it was asked, never as one list of both teams", async () => {
      const lists = ['team-a', 'team-b'].map((team) => ({ fields: 'newest', kinds: [30850], '#h': [team] }))
      const files = lists.flatMap((list) =>
        Array.from({ length: 20 }, (_, i) => event(30850, [['d', `${list['#h'][0]}-${i}`], ['h', list['#h'][0]]], 1_000 + i)),
      )
      const copy = createEventSnapshot({ storage: memorySnapshotStorage(), scope: 'test', version: 1 })
      await copy.ready
      for (const list of lists) copy.absorb([list as SnapshotFilter], files.filter((e) => e.tags[1][1] === list['#h'][0]))
      const relay = fakeRelay(files)

      const answer = await catchUpFromCopy(copy, lists, options(relay))

      expect(relay.asked()).toEqual([])
      expect(relay.reconciled).toEqual(expect.arrayContaining(lists))
      expect(relay.reconciled).toHaveLength(2)
      expect(answer?.events).toHaveLength(40)
    })
  })

  it('asks a list cut by its limit plainly, though the copy holds the whole list: files past the cut are not its answer', async () => {
    const whole = { fields: 'newest', kinds: [9], '#h': [room] }
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding([whole], before)
    const relay = fakeRelay(before)

    expect(await catchUpFromCopy(copy, [{ ...whole, limit: 10 }], options(relay))).toBeNull()
    expect(relay.reconcile).not.toHaveBeenCalled()
  })

  it("asks a list read the copy never answered plainly: its events alone do not say what it lists", async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding(asked, before)
    const relay = fakeRelay(before)
    const list = { fields: 'newest', kinds: [9], '#h': [room] }

    expect(await catchUpFromCopy(copy, [list], options(relay))).toBeNull()
    expect(relay.reconcile).not.toHaveBeenCalled()
  })

  it('leaves every question to be asked as before when the relay does not speak NIP-77', async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding(asked, before)
    const relay = fakeRelay(before)

    expect(await catchUpFromCopy(copy, asked, { ...options(relay), speaksNip77: () => false })).toBeNull()
    expect(relay.reconcile).not.toHaveBeenCalled()
    expect(relay.ask).not.toHaveBeenCalled()
  })

  it("answers the relay's refusal when fetching what is missing is refused", async () => {
    const before = Array.from({ length: 20 }, (_, i) => event(9, [['h', room]], 1_000 + i))
    const copy = await copyHolding(asked, before)
    const relay = fakeRelay([...before, event(9, [['h', room]], 2_000)])
    relay.ask.mockResolvedValue({ ok: false, events: [], reason: 'restricted: not a member' } as never)

    expect(await catchUpFromCopy(copy, asked, options(relay))).toEqual({ ok: false, events: [], reason: 'restricted: not a member' })
  })
})
