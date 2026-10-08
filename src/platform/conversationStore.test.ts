import { describe, expect, it, vi } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { createConversationStore, matchesFilter } from './conversationStore'

const ALICE = 'a'.repeat(64)
const BOB = 'b'.repeat(64)

let next = 0
function event(over: Partial<SignedEvent> = {}): SignedEvent {
  next += 1
  return {
    id: next.toString(16).padStart(64, '0'),
    pubkey: ALICE,
    created_at: 1_000 + next,
    kind: 9,
    tags: [],
    content: '',
    sig: '',
    ...over,
  }
}

const store = () => createConversationStore<string>({ lookbackSeconds: 100 })

describe('matchesFilter', () => {
  const e = event({ kind: 1111, tags: [['A', '30840:x:d'], ['e', 'f'.repeat(64)]], created_at: 500 })

  it('reads ids, kinds, authors, tags, since and until as NIP-01 does', () => {
    expect(matchesFilter(e, { kinds: [1111], '#A': ['30840:x:d'] })).toBe(true)
    expect(matchesFilter(e, { kinds: [9] })).toBe(false)
    expect(matchesFilter(e, { authors: [BOB] })).toBe(false)
    expect(matchesFilter(e, { ids: [e.id] })).toBe(true)
    expect(matchesFilter(e, { '#e': ['0'.repeat(64)] })).toBe(false)
    expect(matchesFilter(e, { since: 500, until: 500 })).toBe(true)
    expect(matchesFilter(e, { since: 501 })).toBe(false)
    expect(matchesFilter(e, { until: 499 })).toBe(false)
  })

  it('answers nothing for a field it cannot judge, rather than everything', () => {
    expect(matchesFilter(e, { search: 'hello' })).toBe(false)
  })
})

describe('createConversationStore', () => {
  it('holds a read with its cursor at the start of the read, less the lookback', () => {
    const s = store()
    s.replace('k', 'value', [event()], 10_500_000)
    expect(s.value('k')).toBe('value')
    expect(s.since('k')).toBe(10_500 - 100)
  })

  it('keeps the same value object until it changes, and tells subscribers when it does', () => {
    const s = store()
    const heard = vi.fn()
    s.subscribe('k', heard)
    s.replace('k', 'one', [], 0)
    expect(heard).toHaveBeenCalledTimes(1)
    s.settle('k', 5_000_000)
    expect(heard).toHaveBeenCalledTimes(1)
    expect(s.since('k')).toBe(5_000 - 100)
    s.settle('k', 6_000_000, 'two')
    expect(heard).toHaveBeenCalledTimes(2)
    expect(s.value('k')).toBe('two')
  })

  it('answers filters from what it holds, newest first, each filter to its limit', async () => {
    const s = store()
    const old = event({ created_at: 1 })
    const mid = event({ created_at: 2 })
    const fresh = event({ created_at: 3 })
    const reaction = event({ kind: 7, created_at: 4, tags: [['e', old.id]] })
    s.replace('k', '', [old, mid, fresh, reaction], 0)
    const answer = await s.query('k')([{ kinds: [9], limit: 2 }, { kinds: [7], '#e': [old.id] }])
    expect(answer.map((e) => e.id)).toEqual([fresh.id, mid.id, reaction.id])
  })

  it('merges only what it did not hold, and reports it', () => {
    const s = store()
    const held = event()
    s.replace('k', '', [held], 0)
    const added = event()
    expect(s.merge('k', [held, added]).added).toEqual([added])
    expect(s.ids('k')).toEqual([held.id, added.id])
  })

  it('a deletion by the author removes the target; by anybody else it is disputed', async () => {
    const s = store()
    const mine = event({ pubkey: ALICE })
    const theirs = event({ pubkey: BOB })
    s.replace('k', '', [mine, theirs], 0)
    const merged = s.merge('k', [
      event({ kind: 5, pubkey: ALICE, tags: [['e', mine.id]] }),
      event({ kind: 5, pubkey: ALICE, tags: [['e', theirs.id]] }),
    ])
    expect(merged.disputed).toEqual([theirs.id])
    const left = await s.query('k')([{ kinds: [9] }])
    expect(left.map((e) => e.id)).toEqual([theirs.id])
    s.forget('k', merged.disputed)
    expect(await s.query('k')([{ kinds: [9] }])).toEqual([])
  })

  it('evicts the least recently opened conversation first', () => {
    const s = createConversationStore<string>({ lookbackSeconds: 0, capacity: 2 })
    s.replace('a', 'A', [], 0)
    s.replace('b', 'B', [], 0)
    s.touch('a')
    s.replace('c', 'C', [], 0)
    expect(s.keys()).toEqual(['a', 'c'])
    s.replace('d', 'D', [], 0)
    expect(s.keys()).toEqual(['c', 'd'])
    expect(s.value('a')).toBeUndefined()
  })

  it('never evicts a conversation somebody is drawing', () => {
    const s = createConversationStore<string>({ lookbackSeconds: 0, capacity: 2 })
    const onScreen = vi.fn()
    s.subscribe('a', onScreen)
    s.replace('a', 'A', [], 0)
    s.replace('b', 'B', [], 0)
    s.replace('c', 'C', [], 0)
    expect(s.keys()).toEqual(['a', 'c'])
    expect(s.value('a')).toBe('A')
  })

  it('merging into, or settling, a conversation it does not hold changes nothing', () => {
    const s = store()
    expect(s.merge('gone', [event()])).toEqual({ added: [], disputed: [] })
    s.settle('gone', 0, 'x')
    expect(s.value('gone')).toBeUndefined()
    expect(s.keys()).toEqual([])
  })
})
