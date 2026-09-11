/**
 * A reference drawn where it was written — SPEC §13.1, RIC-10.
 *
 * `MentionChip`'s tests are here, unchanged in meaning: a mention names a key,
 * so it resolves for anyone and survives a rename, and an unresolvable key
 * still draws a mention because saying "somebody" is the correct answer and
 * saying nothing is not.
 *
 * What is new is that the same component answers for an **object**. Its last
 * case is the one that deliberately changed: an `naddr` used to be handed back
 * as raw text, on the grounds that objects are drawn as widgets below. They are
 * still drawn below when they stand alone — but one written mid-sentence is
 * drawn here now, and a reader must never see a 200-character pointer either
 * way.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { encodeNpub } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'

const KNOWN = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const STRANGER = 'cd'.repeat(32)

/**
 * A stand-in for the module-level snapshot, with its notification.
 *
 * The real one starts as the mock cast and is replaced once the Convex people
 * query resolves — so "the directory does not know this key *yet*" is the
 * normal state on a cold load, not an edge case.
 */
const names = new Map<string, string>([[KNOWN, 'Ada Lovelace']])
let version = 0
const listeners = new Set<() => void>()

/** What `MentionDirectorySync` does when the query lands. */
function directoryArrives(entries: Iterable<[string, string]>) {
  act(() => {
    for (const [pubkey, name] of entries) names.set(pubkey, name)
    version += 1
    for (const listener of listeners) listener()
  })
}

vi.mock('@/api/mentions', () => ({
  personByPubkey: (pubkey: string) => {
    const name = names.get(pubkey)
    return name ? { id: name, name, role: 'Engineer' } : undefined
  },
  subscribeMentions: (onChange: () => void) => {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  },
  mentionsVersion: () => version,
}))

beforeEach(() => {
  names.clear()
  names.set(KNOWN, 'Ada Lovelace')
  version = 0
  listeners.clear()
})

import { Reference } from './Reference'

const object = (overrides: Partial<ForeignObject> = {}): ForeignObject => ({
  ref: '30851:abc:i1',
  eventId: 'e'.repeat(64),
  address: '30851:abc:i1',
  naddr: 'naddr1i1',
  kind: 30851,
  widget: 'row',
  appName: 'Estiva Ship',
  slots: { title: { value: 'Ship the block model' }, status: { value: 'In Progress', colour: 'blue', field: 'status' } },
  meta: [],
  comments: [],
  actions: [],
  viaRecommendation: true,
  ...overrides,
})

describe('Reference, for a person', () => {
  it('names the person when the directory knows them', () => {
    const c = render(<Reference uri={`nostr:${encodeNpub(KNOWN)}`} />).container
    expect(c.textContent).toBe('@Ada Lovelace')
    expect(c.querySelector('[data-resolved="true"]')).not.toBeNull()
  })

  it('still draws a mention for a key it cannot resolve', () => {
    // §13.1: "the URI's own label or its shortened form, never blank." A key
    // from outside this workspace is exactly the case the old form could not
    // represent at all.
    const c = render(<Reference uri={`nostr:${encodeNpub(STRANGER)}`} />).container
    expect(c.textContent).not.toBe('')
    expect(c.textContent).toMatch(/^npub1.*…$/)
    expect(c.querySelector('[data-resolved="false"]')).not.toBeNull()
  })

  it('carries the key itself, so what it means does not depend on the label', () => {
    const c = render(<Reference uri={`nostr:${encodeNpub(KNOWN)}`} />).container
    expect(c.querySelector(`[data-mention="${KNOWN}"]`)).not.toBeNull()
  })

  it('shows the whole URI on hover when it could not name anyone', () => {
    const uri = `nostr:${encodeNpub(STRANGER)}`
    const c = render(<Reference uri={uri} />).container
    expect(c.querySelector('[title]')?.getAttribute('title')).toBe(uri)
  })

  it('resolves when the directory arrives, without anything else re-rendering', () => {
    /*
      THE REGRESSION (reported as "my tags are like this lately", peek#174).

      `personByPubkey` reads a module-level snapshot, which is right — the Tiptap
      suggestion plugins are not components and cannot hold a hook. But a module
      variable cannot tell React it changed, and the snapshot starts as the mock
      cast whose keys match nobody real. So a message body drawn before the
      Convex people query resolved kept its raw `npub…` chips until something
      unrelated happened to re-render it, and on a cold load that is every
      mention in view.

      The intermittency is the whole tell: whether a mention showed a name
      depended on whether its message was drawn before or after one query landed.
    */
    const stranger = `nostr:${encodeNpub(STRANGER)}`
    const c = render(<Reference uri={stranger} />).container
    expect(c.textContent).toMatch(/^npub1.*…$/)

    directoryArrives([[STRANGER, 'Katerina Kelepouri']])

    expect(c.textContent).toBe('@Katerina Kelepouri')
    expect(c.querySelector('[data-resolved="true"]')).not.toBeNull()
  })
})

describe('Reference, for an object', () => {
  it('says what the object is called, not what it is addressed by', () => {
    const c = render(<Reference uri="nostr:naddr1abc" object={object()} />).container
    expect(c.textContent).toContain('Ship the block model')
    expect(c.textContent).not.toContain('naddr1abc')
  })

  it('shows the status the manifest declares, in the colour it declares', () => {
    // The same `StatusPill` the attachment card draws, so the inline variant
    // and the card cannot disagree about what a status looks like.
    const c = render(<Reference uri="nostr:naddr1abc" object={object()} />).container
    expect(c.textContent).toContain('In Progress')
    expect(c.querySelector('.text-info-default')).not.toBeNull()
  })

  it('draws a title alone when the manifest declares no status', () => {
    const slots = { title: { value: 'A project' } }
    const c = render(<Reference uri="nostr:naddr1abc" object={object({ slots })} />).container
    expect(c.textContent).toBe('A project')
  })

  it('carries the address, so a test or a reader can tell which object it is', () => {
    const c = render(<Reference uri="nostr:naddr1abc" object={object()} />).container
    expect(c.querySelector('[data-object="30851:abc:i1"]')).not.toBeNull()
  })
})

describe('Reference, unresolved', () => {
  it('never shows a raw pointer, however long it was', () => {
    /*
      The case that changed. `MentionChip` returned this URI as text, which was
      survivable while every `naddr` had already been cut out of the prose
      before it got here. Now that one written mid-sentence stays, a component
      that gives back the raw pointer would put the whole thing in the sentence.
    */
    const uri = `nostr:naddr1${'q'.repeat(200)}`
    const c = render(<Reference uri={uri} />).container
    expect(c.textContent).not.toBe('')
    expect(c.textContent!.length).toBeLessThan(20)
    expect(c.querySelector('[title]')?.getAttribute('title')).toBe(uri)
  })

  it('tells "still resolving" from "resolved to nothing"', () => {
    // Drawn identically — neither is something a reader can act on — but they
    // are different facts, and flattening them is the PEE-10 failure.
    const pending = render(<Reference uri="nostr:naddr1abc" />).container
    const nothing = render(<Reference uri="nostr:naddr1abc" object={null} />).container
    expect(pending.querySelector('[data-reference="pending"]')).not.toBeNull()
    expect(nothing.querySelector('[data-reference="unresolved"]')).not.toBeNull()
    expect(pending.textContent).toBe(nothing.textContent)
  })

  it('does not claim an object it cannot reach', () => {
    // `unreachable` is interop saying "there is an object here and you may not
    // read it". Drawing its empty title as a name would state a blank
    // confidently; the shortened URI at least says a reference is there.
    const c = render(
      <Reference uri="nostr:naddr1abc" object={object({ unreachable: true, slots: {} })} />,
    ).container
    expect(c.textContent).toMatch(/^naddr1.*…$/)
  })
})
