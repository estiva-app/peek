import { describe, expect, it, vi } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { createConversationStore, matchesFilter } from '@/platform/conversationStore'
import type { FileConversation } from './fileConversation'

vi.mock('./bridge', () => ({ queryRelay: vi.fn(), publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

const { catchUpConversation, readConversation } = await import('./conversationCatchUp')

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
    expect(relay.asked[0][0]).toEqual({ kinds: [9, 40003, 9101], '#h': [FOLDER], since })
    expect(relay.asked[0].every((filter) => filter.since === since)).toBe(true)
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
