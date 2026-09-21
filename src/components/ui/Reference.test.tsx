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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { addrToNaddr, encodeNevent, encodeNpub } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { registerThreadOpener, unregisterThreadOpener } from '@/lib/threadOpener'
import { registerTopicConversation, unregisterTopicConversation } from '@/lib/conversationRegistry'

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

  it('shows the whole URI on hover when it could not name anyone', async () => {
    // In the package's tooltip, not a native `title` (UIG-14): one hover, one tip.
    const user = userEvent.setup()
    const uri = `nostr:${encodeNpub(STRANGER)}`
    const c = render(<Reference uri={uri} />).container
    expect(c.querySelector('[title]')).toBeNull()
    await user.hover(c.querySelector('[data-resolved="false"]')!)
    expect((await screen.findByRole('tooltip')).textContent).toBe(uri)
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

  it('follows a rename: the same key, drawn in an old message, shows the current name (RIC-2)', () => {
    /*
      The reason a mention is written as a key. The body is immutable, so a
      display name in it can never be corrected; a key is resolved every time it
      is drawn, so a person who changes their name is named correctly in every
      message that ever mentioned them. This half is the renderer; the other
      half — Peek's directory actually learning the new name from the relay —
      is `resolveExternalUser`, pinned in `convex/profileRefresh.test.ts`.
    */
    const uri = `nostr:${encodeNpub(KNOWN)}`
    const c = render(<Reference uri={uri} />).container
    expect(c.textContent).toBe('@Ada Lovelace')

    directoryArrives([[KNOWN, 'Ada King']])

    expect(c.textContent).toBe('@Ada King')
    // Still the same person: the key on the chip is what a reader acts on.
    expect(c.querySelector(`[data-mention="${KNOWN}"]`)).not.toBeNull()
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

  it('puts no block inside the sentence it sits in', () => {
    // The tooltip's wrapper is a <span> (`inline`): a <div> inside a <p> is
    // invalid HTML, and React says so for every message holding a reference.
    const c = render(
      <p>
        See <Reference uri="nostr:naddr1abc" object={object()} /> and{' '}
        <Reference uri={`nostr:naddr1${'q'.repeat(60)}`} />.
      </p>,
    ).container
    expect(c.querySelectorAll('[data-reference]')).toHaveLength(2)
    expect(c.querySelector('p div')).toBeNull()
  })

  it('shows the whole title on hover, because the chip cuts it short', async () => {
    // In the package's tooltip, not a native `title` (UIG-14).
    const user = userEvent.setup()
    const c = render(<Reference uri="nostr:naddr1abc" object={object()} />).container
    expect(c.querySelector('[title]')).toBeNull()
    await user.hover(c.querySelector('[data-object]')!)
    expect((await screen.findByRole('tooltip')).textContent).toBe('Ship the block model')
  })
})

/**
 * A Peek message, through Peek's own manifest (RIC-11). It has no title of its
 * own, so the manifest titles it by its author — `field: "pubkey", as:
 * "pubkey"` — and carries the body as `body`. Drawing the title slot's value
 * would draw 64 hex characters.
 */
describe('Reference, for a message', () => {
  const message = (people?: ForeignObject['people']) =>
    object({
      ref: 'nevent1msg',
      address: undefined,
      naddr: undefined,
      kind: 9,
      widget: ['message', 'card'],
      appName: 'Peek',
      slots: {
        title: { value: KNOWN, isPubkey: true },
        body: { value: 'The **build** is green again, thanks all.' },
      },
      people,
    })

  it('names the author and quotes the opening words, marks stripped', () => {
    const c = render(<Reference uri="nostr:nevent1msg" object={message({ [KNOWN]: { displayName: 'Ada Lovelace' } })} />).container
    expect(c.textContent).toBe('Ada Lovelace: The build is green again, thanks all.')
    expect(c.textContent).not.toContain(KNOWN)
  })

  it('shortens the key when the runtime found no profile, rather than printing it', () => {
    const c = render(<Reference uri="nostr:nevent1msg" object={message()} />).container
    expect(c.textContent).toContain(`${KNOWN.slice(0, 8)}…`)
    expect(c.textContent).not.toContain(KNOWN)
  })

  it('shows a person-titled object that is not a message by the name alone', () => {
    // `as: "pubkey"` on a title is not what makes something a message; the
    // widget is. An object titled by a person still draws the person.
    const c = render(
      <Reference
        uri="nostr:naddr1abc"
        object={object({ slots: { title: { value: KNOWN, isPubkey: true }, body: { value: 'not quoted' } }, people: { [KNOWN]: { displayName: 'Ada' } } })}
      />,
    ).container
    expect(c.textContent).toBe('Ada')
  })
})

describe('Reference, unresolved', () => {
  it('never shows a raw pointer, however long it was', async () => {
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
    // The whole of it is on hover, in the package's tooltip (UIG-14).
    expect(c.querySelector('[title]')).toBeNull()
    await userEvent.setup().hover(c.querySelector('[data-reference]')!)
    expect((await screen.findByRole('tooltip')).textContent).toBe(uri)
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

/**
 * A chip leads to the thing it names — RIC-16.
 *
 * Miky, after the first pointer mention on production: *"It only creates a
 * label, but not really a link to the mentioned thing"* — and, once it did
 * link: *"It opens the reply thread panel"*, because the card under the chip
 * opens its thread on any click. So there are two things to prove: that the
 * chip is a real link, and that following it is not also a click on the card.
 */
describe('Reference, as a link (RIC-16)', () => {
  const UUID = '0212db6d-bcbf-40d0-890e-f4f056db2f5d'
  const TOPIC_ADDRESS = `39000:${'ab'.repeat(32)}:${UUID}`
  const TOPIC_URI = `nostr:${addrToNaddr(TOPIC_ADDRESS, [])}`
  const topic = () =>
    object({ ref: TOPIC_ADDRESS, address: TOPIC_ADDRESS, kind: 39000, appName: 'Peek', slots: { title: { value: 'Feedback on Ship' } } })
  const MESSAGE_ID = 'cd'.repeat(32)
  const MESSAGE_URI = `nostr:${encodeNevent({ id: MESSAGE_ID, relays: [], kind: 9 })}`
  const message = () =>
    object({ ref: MESSAGE_URI, address: undefined, naddr: undefined, eventId: MESSAGE_ID, kind: 9, widget: ['message', 'card'], appName: 'Peek', slots: { title: { value: KNOWN, isPubkey: true } } })

  function Where() {
    return <output data-testid="where">{useLocation().pathname}</output>
  }
  const routed = (ui: React.ReactNode) =>
    render(
      <MemoryRouter initialEntries={['/topics']}>
        {ui}
        <Where />
      </MemoryRouter>,
    )

  afterEach(() => {
    unregisterThreadOpener()
    unregisterTopicConversation()
  })

  it('a topic chip is a real link to the topic, even with no router around it', () => {
    const c = render(<Reference uri={TOPIC_URI} object={topic()} />).container
    const a = c.querySelector('a')
    expect(a?.getAttribute('href')).toBe(`/topic-old/feedback-on-ship-${UUID}`)
    expect(a?.textContent).toBe('Feedback on Ship')
  })

  it('a person chip is a link to their DM', () => {
    const c = render(<Reference uri={`nostr:${encodeNpub(KNOWN)}`} />).container
    expect(c.querySelector('a')?.getAttribute('href')).toBe('/app/people/Ada%20Lovelace')
  })

  it('a label that leads nowhere is not a link', () => {
    expect(render(<Reference uri={TOPIC_URI} object={null} />).container.querySelector('a')).toBeNull()
    expect(render(<Reference uri={`nostr:${encodeNpub(STRANGER)}`} />).container.querySelector('a')).toBeNull()
  })

  it('following a chip is not a click on the card under it', () => {
    const card = vi.fn()
    const c = routed(
      <div onClick={card}>
        <Reference uri={TOPIC_URI} object={topic()} />
      </div>,
    ).container
    const a = c.querySelector('a')!
    // The card's own test for "not mine", and the event never reaching it.
    expect(a.hasAttribute('data-interactive')).toBe(true)
    fireEvent.click(a)
    expect(card).not.toHaveBeenCalled()
  })

  it('a plain click opens the topic in place; a modified click is left to the browser', () => {
    const r = routed(<Reference uri={TOPIC_URI} object={topic()} />)
    const a = r.container.querySelector('a')!
    expect(fireEvent.click(a, { ctrlKey: true })).toBe(true) // default not prevented: open in new tab
    expect(r.getByTestId('where').textContent).toBe('/topics')
    expect(fireEvent.click(a)).toBe(false)
    expect(r.getByTestId('where').textContent).toBe(`/topic-old/feedback-on-ship-${UUID}`)
  })

  it('a message on screen opens its conversation rather than leaving the page', () => {
    const opener = vi.fn()
    registerThreadOpener(opener)
    registerTopicConversation({
      references: [],
      messages: [{ id: 'c1', author: 'Ada', timestamp: '9:41 AM', body: 'Green.', eventId: MESSAGE_ID, conversationId: 'c1' }],
    })
    const r = routed(<Reference uri={MESSAGE_URI} object={message()} />)
    const a = r.container.querySelector('a')!
    expect(a.getAttribute('href')).toBe(`/message/${MESSAGE_ID}`)
    fireEvent.click(a)
    expect(opener).toHaveBeenCalledWith('c1')
    expect(r.getByTestId('where').textContent).toBe('/topics')
  })

  it('a message elsewhere leaves for /message/<id>, which finds its topic', () => {
    const r = routed(<Reference uri={MESSAGE_URI} object={message()} />)
    fireEvent.click(r.container.querySelector('a')!)
    expect(r.getByTestId('where').textContent).toBe(`/message/${MESSAGE_ID}`)
  })

  it("another app's object opens in that app, in a new tab", () => {
    const r = routed(<Reference uri="nostr:naddr1issue" object={object({ openUrl: 'https://ship.estiva.app/i/abc' })} />)
    const a = r.container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('https://ship.estiva.app/i/abc')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toContain('noopener')
    // Not intercepted: the router has nowhere to take a foreign URL.
    expect(fireEvent.click(a)).toBe(true)
    expect(r.getByTestId('where').textContent).toBe('/topics')
  })
})
