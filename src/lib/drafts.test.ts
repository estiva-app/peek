/**
 * Drafts survive leaving, and never leak — CON-10.
 *
 * The cases here are PEE-7's two symptoms plus the ways `localStorage` fails,
 * which is most of the work: a private window, blocked site data and a full
 * quota all have to read as "no draft" rather than as a broken composer.
 */
import { describe, expect, it } from 'vitest'
import {
  DRAFT_MAX_AGE_MS,
  DRAFT_MAX_CHARS,
  createDraftStore,
  draftKeys,
} from './drafts'

/** A `Storage` that is just a Map, so a test needs no browser. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  } as Storage
}

/** A `Storage` where every operation throws — a browser blocking site data. */
const hostile: Storage = new Proxy({} as Storage, {
  get() {
    return () => {
      throw new Error('storage is blocked')
    }
  },
})

describe('draft keys', () => {
  /*
    PEE-7, both halves. Two objects must not share a draft, and a thread must
    keep its own wherever it is read — an issue page and a project's Activity
    show the same thread and it is one destination.
  */
  it('gives two objects different keys', () => {
    expect(draftKeys.object('30851:a:one')).not.toBe(draftKeys.object('30851:a:two'))
  })

  it('keys a thread by its root, not by the surface showing it', () => {
    expect(draftKeys.thread('abc')).toBe(draftKeys.thread('abc'))
  })

  it('cannot confuse an object with a thread of the same id', () => {
    expect(draftKeys.object('x')).not.toBe(draftKeys.thread('x'))
  })

  /* Peek's addition: a topic and a DM are destinations Ship has no equivalent
     of, and a container must not collide with a thread of the same id. */
  it('keeps containers apart from threads and from each other', () => {
    expect(draftKeys.container('x')).not.toBe(draftKeys.thread('x'))
    expect(draftKeys.container('topic-1')).not.toBe(draftKeys.container('topic-2'))
  })
})

describe('a draft store', () => {
  it('keeps text and hands it back', () => {
    const s = createDraftStore(memoryStorage())
    s.write('k', 'half a thought')
    expect(s.read('k')).toBe('half a thought')
  })

  it('has nothing for a key never written', () => {
    expect(createDraftStore(memoryStorage()).read('k')).toBeUndefined()
  })

  it('does not leak between keys', () => {
    const s = createDraftStore(memoryStorage())
    s.write(draftKeys.object('one'), 'for one')
    expect(s.read(draftKeys.object('two'))).toBeUndefined()
  })

  it('forgets on clear — what a successful send does', () => {
    const s = createDraftStore(memoryStorage())
    s.write('k', 'sent now')
    s.clear('k')
    expect(s.read('k')).toBeUndefined()
  })

  /* Emptying the field is how a person says "never mind". */
  it('treats an emptied field as cleared', () => {
    const s = createDraftStore(memoryStorage())
    s.write('k', 'typed')
    s.write('k', '   ')
    expect(s.read('k')).toBeUndefined()
  })

  it('does not store beyond the size cap, and keeps no stale value', () => {
    const storage = memoryStorage()
    const s = createDraftStore(storage)
    s.write('k', 'short')
    s.write('k', 'x'.repeat(DRAFT_MAX_CHARS + 1))
    // Not stored, and the earlier one is gone rather than resurrecting.
    expect(s.read('k')).toBeUndefined()
  })

  /* A draft from months ago reappearing is surprising rather than helpful. */
  it('drops a draft past the age cap, and sweeps it', () => {
    const storage = memoryStorage()
    let now = 1_000_000
    const s = createDraftStore(storage, () => now)
    s.write('k', 'old thought')
    now += DRAFT_MAX_AGE_MS + 1
    expect(s.read('k')).toBeUndefined()
    expect(storage.length).toBe(0)
  })

  it('keeps one that is only just inside the cap', () => {
    let now = 1_000_000
    const s = createDraftStore(memoryStorage(), () => now)
    s.write('k', 'recent enough')
    now += DRAFT_MAX_AGE_MS - 1
    expect(s.read('k')).toBe('recent enough')
  })

  /* Written by a different version, or corrupted. Showing it would be showing
     a string this code cannot vouch for. */
  it('drops a value it cannot read, rather than guessing', () => {
    const storage = memoryStorage()
    storage.setItem('estiva.draft.v1:k', '{not json')
    const s = createDraftStore(storage)
    expect(s.read('k')).toBeUndefined()
  })

  it('drops a value of the wrong shape', () => {
    const storage = memoryStorage()
    storage.setItem('estiva.draft.v1:k', JSON.stringify({ text: 42 }))
    expect(createDraftStore(storage).read('k')).toBeUndefined()
  })

  /*
    The failure that must never reach a person. A blocked or full storage means
    no draft; it does not mean an unusable composer.
  */
  it('reads as empty when storage throws on every call', () => {
    const s = createDraftStore(hostile)
    expect(() => s.write('k', 'text')).not.toThrow()
    expect(() => s.clear('k')).not.toThrow()
    expect(s.read('k')).toBeUndefined()
  })

  it('keeps nothing at all when there is no storage', () => {
    const s = createDraftStore(undefined)
    s.write('k', 'text')
    expect(s.read('k')).toBeUndefined()
  })

  /*
    Two tabs on one thread share `localStorage` and will overwrite each other.
    Last write wins — decided rather than discovered, and asserted so a future
    change to it is deliberate.
  */
  it('lets the last writer win across two stores on one storage', () => {
    const storage = memoryStorage()
    const tabA = createDraftStore(storage)
    const tabB = createDraftStore(storage)
    tabA.write('k', 'from A')
    tabB.write('k', 'from B')
    expect(tabA.read('k')).toBe('from B')
  })
})
