import { describe, expect, it, vi } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { createConversationStore, matchesFilter } from '@/platform/conversationStore'
import type { FileConversation } from './fileConversation'

vi.mock('./bridge', () => ({ queryRelay: vi.fn(), publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

const { applyLiveEvents, catchUpConversation, confirmOwnEvent, readConversation, showOwnEvent, withdrawOwnEvent } = await import(
  './conversationCatchUp'
)

/*
  OPT-3 — a held conversation brought up to date in one request when nothing
  changed and two when something did, folded by the read's own code over what
  is held. The relay here is a list of events answering NIP-01 filters, so what
  is pinned is what a catch-up *asks* and what the fold then *draws*.
*/
const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)
const FOLDER = '11111111-1111-4111-8111-111111111111'
const ADDRESS = `30840:${ALICE}:topic`

let clock = 1_800_000_000
let serial = 0
function event(over: Partial<SignedEvent>): SignedEvent {
  serial += 1
  clock += 1
  return { id: serial.toString(16).padStart(64, '0'), pubkey: ALICE, created_at: clock, kind: 9, tags: [], content: `m${serial}`, sig: '', ...over }
}

function fakeRelay(events: SignedEvent[]) {
  const asked: Record<string, unknown>[][] = []
  const query = async (filters: Record<string, unknown>[]) => {
    asked.push(filters)
    const answer = new Map<string, SignedEvent>()
    for (const filter of filters) for (const e of events) if (matchesFilter(e, filter)) answer.set(e.id, e)
    return [...answer.values()]
  }
  return { events, asked, query }
}

async function held(container: Parameters<typeof readConversation>[0], rootIds: string[], relay: ReturnType<typeof fakeRelay>) {
  const store = createConversationStore<FileConversation>({ lookbackSeconds: 60 })
  const { value, events } = await readConversation(container, rootIds, relay.query)
  store.replace('k', value, events, clock * 1000)
  relay.asked.length = 0
  return store
}

describe('catchUpConversation — a channel', () => {
  const channel = { kind: 'channel' as const, h: FOLDER }
  const message = (over: Partial<SignedEvent> = {}) => event({ kind: 9, tags: [['h', FOLDER]], ...over })

  it('nothing new: one request, and the conversation drawn is unchanged', async () => {
    const relay = fakeRelay([message()])
    const store = await held(channel, [], relay)
    const before = store.value('k')
    const found = await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(found.changed).toBe(false)
    expect(relay.asked).toHaveLength(1)
    expect(relay.asked[0].length).toBeLessThanOrEqual(10)
    expect(store.value('k')).toBe(before)
  })

  it('a new message and a reaction: two requests, both drawn', async () => {
    const first = message()
    const relay = fakeRelay([first])
    const store = await held(channel, [], relay)
    const fresh = message({ pubkey: BOB })
    relay.events.push(fresh, event({ kind: 7, pubkey: BOB, content: '+', tags: [['e', first.id], ['p', ALICE]] }))
    const found = await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(found.changed).toBe(true)
    expect(relay.asked).toHaveLength(2)
    const value = store.value('k')!
    expect(value.roots.map((r) => r.id)).toEqual([first.id, fresh.id])
    expect(value.decorations.byId[first.id].reactions).toHaveLength(1)
  })

  it('a deletion by its author takes the message away; by anybody else it is asked about', async () => {
    const mine = message()
    const theirs = message({ pubkey: BOB })
    const relay = fakeRelay([mine, theirs])
    const store = await held(channel, [], relay)
    relay.events.push(event({ kind: 5, tags: [['e', mine.id]] }), event({ kind: 5, tags: [['e', theirs.id]] }))
    // The relay judged the second deletion and kept the message.
    await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(relay.asked[1]).toContainEqual({ ids: [theirs.id], limit: 1 })
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([theirs.id])
  })

  it('asks from the cursor, less the lookback', async () => {
    const relay = fakeRelay([message()])
    const store = await held(channel, [], relay)
    const since = store.since('k')
    await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(relay.asked[0][0]).toEqual({ kinds: [9, 40003, 9101, 9005], '#h': [FOLDER], since })
    // Everything but the lookup by id, which asks whether the newest message is still readable.
    expect(relay.asked[0].filter((filter) => !filter.ids).every((filter) => filter.since === since)).toBe(true)
  })

  it('a Folder the viewer lost is reported, and nothing is merged', async () => {
    const relay = fakeRelay([message()])
    const store = await held(channel, [], relay)
    const before = store.value('k')
    // Buzz answers a channel one may not read with nothing at all.
    relay.events.length = 0
    const found = await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(found.lost).toBe(true)
    expect(store.value('k')).toBe(before)
  })

  it('a second request that fails still draws what the first found, and keeps the cursor', async () => {
    const old = message()
    const relay = fakeRelay([old])
    const store = await held(channel, [], relay)
    const since = store.since('k')
    const fresh = message({ pubkey: BOB })
    relay.events.push(fresh, event({ kind: 5, tags: [['e', old.id]] }))
    let calls = 0
    const flaky = async (filters: Record<string, unknown>[]) => {
      calls += 1
      if (calls === 2) throw new Error('rate-limited: slow down')
      return relay.query(filters)
    }
    await expect(catchUpConversation(store, 'k', channel, [], flaky)).rejects.toThrow('rate-limited')
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([fresh.id])
    expect(store.since('k')).toBe(since)
  })

  it('an admin’s delete, and one by somebody who wrote nothing here, are asked about and applied', async () => {
    const CAROL = 'c'.repeat(64)
    const first = message()
    const second = message({ pubkey: BOB })
    const relay = fakeRelay([first, second])
    const store = await held(channel, [], relay)
    relay.events.push(
      event({ kind: 9005, pubkey: CAROL, tags: [['h', FOLDER], ['e', first.id]] }),
      event({ kind: 5, pubkey: CAROL, tags: [['e', second.id]] }),
    )
    // The relay took both: the targets are gone from it.
    relay.events.splice(relay.events.indexOf(first), 1)
    relay.events.splice(relay.events.indexOf(second), 1)
    await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(store.value('k')!.roots).toEqual([])
  })

  it('asks in one REQ however long the conversation is', async () => {
    const relay = fakeRelay(Array.from({ length: 1_500 }, (_, i) => message({ pubkey: i % 2 ? ALICE : BOB })))
    const store = await held(channel, [], relay)
    await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(relay.asked).toHaveLength(1)
    expect(relay.asked[0].length).toBeLessThanOrEqual(10)
  })
})

describe('catchUpConversation — a file', () => {
  const file = { kind: 'file' as const, address: ADDRESS, h: FOLDER }
  const comment = (over: Partial<SignedEvent> = {}) =>
    event({ kind: 1111, tags: [['A', ADDRESS], ['K', '30840'], ['a', ADDRESS], ['k', '30840'], ['h', FOLDER]], ...over })

  it('a root the object does not list yet is drawn from what the catch-up found', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id])
    const fresh = comment({ pubkey: BOB })
    relay.events.push(fresh)
    const found = await catchUpConversation(store, 'k', file, [first.id], relay.query)
    expect(found).toEqual({ changed: true, object: false, mentions: false, authors: [BOB] })
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id, fresh.id])
  })

  it('a change to the file itself is reported, for the object to be read again', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    relay.events.push(event({ kind: 1851, tags: [['a', ADDRESS], ['field', 'title'], ['value', 'Renamed']] }))
    const found = await catchUpConversation(store, 'k', file, [first.id], relay.query)
    expect(found).toEqual({ changed: false, object: true, mentions: false, authors: [] })
    expect(relay.asked).toHaveLength(1)
  })

  it('a message elsewhere naming the file is reported as a mention, not drawn as a comment', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    relay.events.push(event({ kind: 9, tags: [['h', '33333333-3333-4333-8333-333333333333'], ['a', ADDRESS]] }))
    const found = await catchUpConversation(store, 'k', file, [first.id], relay.query)
    expect(found.mentions).toBe(true)
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id])
  })

  it('talk elsewhere in the Folder is not taken into the file’s conversation', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    relay.events.push(event({ kind: 9, tags: [['h', FOLDER]] }))
    const found = await catchUpConversation(store, 'k', file, [first.id], relay.query)
    expect(found.changed).toBe(false)
    expect(store.ids('k')).toEqual([first.id])
  })
})

/*
  OPT-5 — what the socket delivers in the Folder, applied with no read: the
  relay is never asked, the conversation is folded from what is held, and the
  cursor stays where the last read left it.
*/
describe('applyLiveEvents', () => {
  const file = { kind: 'file' as const, address: ADDRESS, h: FOLDER }
  const comment = (over: Partial<SignedEvent> = {}) =>
    event({ kind: 1111, tags: [['A', ADDRESS], ['K', '30840'], ['a', ADDRESS], ['k', '30840'], ['h', FOLDER]], ...over })
  const reply = (root: SignedEvent, over: Partial<SignedEvent> = {}) =>
    event({ kind: 1111, tags: [['A', ADDRESS], ['K', '30840'], ['e', root.id], ['k', '1111'], ['h', FOLDER]], ...over })

  it('a new root and a reply on a file are drawn, and nothing is asked', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    const since = store.since('k')
    const fresh = comment({ pubkey: BOB })
    const answer = reply(first, { pubkey: BOB })
    const found = await applyLiveEvents(store, 'k', file, [first.id], [fresh, answer], relay.query)
    expect(found).toEqual({ changed: true, object: false, mentions: false, authors: [BOB] })
    expect(relay.asked).toEqual([])
    const value = store.value('k')!
    expect(value.roots.map((r) => r.id)).toEqual([first.id, fresh.id])
    expect(value.replies[first.id].map((r) => r.id)).toEqual([answer.id])
    expect(store.since('k')).toBe(since)
  })

  it('an edit of a held comment is drawn, and nothing is asked', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    const edit = event({ kind: 40003, content: 'edited', tags: [['e', first.id], ['h', FOLDER]] })
    const found = await applyLiveEvents(store, 'k', file, [first.id], [edit], relay.query)
    expect(found.changed).toBe(true)
    expect(relay.asked).toEqual([])
    expect(store.value('k')!.decorations.byId[first.id].edit?.body).toBe('edited')
  })

  it('another topic’s talk in the same Folder is dropped: nothing changes, nothing is asked', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    const before = store.value('k')
    const elsewhere = `30840:${ALICE}:other`
    const theirs = event({ kind: 1111, tags: [['A', elsewhere], ['a', elsewhere], ['h', FOLDER]] })
    const found = await applyLiveEvents(
      store,
      'k',
      file,
      [first.id],
      [
        theirs,
        event({ kind: 1111, tags: [['A', elsewhere], ['e', theirs.id], ['h', FOLDER]] }),
        event({ kind: 9, tags: [['h', FOLDER]] }),
        event({ kind: 9005, tags: [['e', theirs.id], ['h', FOLDER]] }),
      ],
      relay.query,
    )
    expect(found).toEqual({ changed: false, object: false, mentions: false, authors: [] })
    expect(relay.asked).toEqual([])
    expect(store.value('k')).toBe(before)
    expect(store.ids('k')).toEqual([first.id])
  })

  it('a field change on the file is reported, for the object to be read again', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    const field = event({ kind: 1851, tags: [['a', ADDRESS], ['h', FOLDER], ['field', 'title'], ['value', 'Renamed']] })
    const found = await applyLiveEvents(store, 'k', file, [first.id], [field], relay.query)
    expect(found).toEqual({ changed: false, object: true, mentions: false, authors: [] })
    expect(relay.asked).toEqual([])
  })

  it('a channel takes its own Folder’s messages, and an event already held is nothing', async () => {
    const channel = { kind: 'channel' as const, h: FOLDER }
    const first = event({ kind: 9, tags: [['h', FOLDER]] })
    const relay = fakeRelay([first])
    const store = await held(channel, [], relay)
    const fresh = event({ kind: 9, pubkey: BOB, tags: [['h', FOLDER]] })
    const elsewhere = event({ kind: 9, tags: [['h', '33333333-3333-4333-8333-333333333333']] })
    expect((await applyLiveEvents(store, 'k', channel, [], [fresh, elsewhere], relay.query)).changed).toBe(true)
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id, fresh.id])
    expect((await applyLiveEvents(store, 'k', channel, [], [fresh], relay.query)).changed).toBe(false)
    expect(relay.asked).toEqual([])
  })

  it('nothing held: nothing applied — the first read is still to come', async () => {
    const store = createConversationStore<FileConversation>({ lookbackSeconds: 60 })
    const relay = fakeRelay([])
    expect((await applyLiveEvents(store, 'k', file, [], [comment()], relay.query)).changed).toBe(false)
    expect(store.value('k')).toBeUndefined()
  })
})

/*
  OPT-6 — your own message, drawn before the relay has it: merged and folded
  from memory, taken out again if refused, and never taken for lost access by
  a catch-up that runs while it is out.
*/
describe('your own message, before the relay answers', () => {
  const file = { kind: 'file' as const, address: ADDRESS, h: FOLDER }
  const channel = { kind: 'channel' as const, h: FOLDER }
  const comment = (over: Partial<SignedEvent> = {}) =>
    event({ kind: 1111, tags: [['A', ADDRESS], ['K', '30840'], ['a', ADDRESS], ['k', '30840'], ['h', FOLDER]], ...over })
  const message = (over: Partial<SignedEvent> = {}) => event({ kind: 9, tags: [['h', FOLDER]], ...over })

  it('a new root on a file is drawn, and nothing is asked', async () => {
    const first = comment()
    const relay = fakeRelay([first])
    const store = await held(file, [first.id], relay)
    const mine = comment()
    expect(await showOwnEvent(store, 'k', file, [first.id], mine, relay.query)).toBe(true)
    expect(relay.asked).toEqual([])
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id, mine.id])
    confirmOwnEvent(mine.id)
  })

  it('refused: taken out again, and the conversation drawn without it', async () => {
    const first = message()
    const relay = fakeRelay([first])
    const store = await held(channel, [], relay)
    const mine = message()
    await showOwnEvent(store, 'k', channel, [], mine, relay.query)
    await withdrawOwnEvent(store, 'k', channel, [], mine.id, relay.query)
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id])
    expect(store.ids('k')).toEqual([first.id])
  })

  it('a catch-up while it is out does not take its absence on the relay for lost access', async () => {
    const first = message()
    const relay = fakeRelay([first])
    const store = await held(channel, [], relay)
    const mine = message()
    await showOwnEvent(store, 'k', channel, [], mine, relay.query)
    const found = await catchUpConversation(store, 'k', channel, [], relay.query)
    expect(found.lost).toBeUndefined()
    expect(relay.asked[0]).toContainEqual({ ids: [first.id], limit: 1 })
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id, mine.id])
    confirmOwnEvent(mine.id)
  })

  it('negative control: once confirmed, it is the message whose absence means lost access', async () => {
    const first = message()
    const relay = fakeRelay([first])
    const store = await held(channel, [], relay)
    const mine = message()
    await showOwnEvent(store, 'k', channel, [], mine, relay.query)
    confirmOwnEvent(mine.id)
    expect((await catchUpConversation(store, 'k', channel, [], relay.query)).lost).toBe(true)
  })

  it('drawn while a catch-up folds: the catch-up does not settle a fold that misses it', async () => {
    const first = message()
    const relay = fakeRelay([first])
    const store = await held(channel, [], relay)
    const theirs = message({ pubkey: BOB })
    relay.events.push(theirs)
    const mine = message()
    // The catch-up's fold (its second look at what is held) reads; the message is merged while that read is out.
    const query = store.query('k')
    let looks = 0
    const spy = vi.spyOn(store, 'query').mockImplementation((key) => {
      looks += 1
      const folding = looks === 2
      return async (filters) => {
        const answer = await query(filters)
        if (folding && !store.ids(key).includes(mine.id)) await showOwnEvent(store, key, channel, [], mine, relay.query)
        return answer
      }
    })
    await catchUpConversation(store, 'k', channel, [], relay.query)
    spy.mockRestore()
    expect(store.value('k')!.roots.map((r) => r.id)).toEqual([first.id, theirs.id, mine.id])
    confirmOwnEvent(mine.id)
  })
})
