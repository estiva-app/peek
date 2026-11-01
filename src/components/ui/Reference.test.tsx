/**
 * A reference drawn where it was written — SPEC §13.1, RIC-10.
 *
 * `MentionChip`'s tests are here, unchanged in meaning: a mention names a key,
 * so it resolves for anyone and survives a rename, and an unresolvable key
 * still draws a mention because saying "somebody" is the correct answer and
 * saying nothing is not.
 *
 * The same component answers for an **object**, and since 2 November (audit
 * A14) through the kit's `LinkChip`, whose own tests hold its look, its link
 * and its loading and missing states. What is Peek's is tested here: the
 * object is named, never addressed, and in an editor its click is held.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
      half — Peek's directory actually learning the new name — reads the
      person's `kind:0` from the relay.
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

describe('Reference, for anything but a person: the kit’s LinkChip (audit A14, 2 November)', () => {
  it('says what the object is called, not what it is addressed by', () => {
    const c = render(<Reference uri="nostr:naddr1abc" object={object()} />).container
    expect(c.textContent).toContain('Ship the block model')
    expect(c.textContent).not.toContain('naddr1abc')
  })

  it('in an editor (`link={false}`) a click on it is held: writing is not a way out of the draft', () => {
    const c = render(<Reference uri="nostr:naddr1abc" object={object({ openUrl: 'https://ship.estiva.app/i/abc' })} link={false} />).container
    // `fireEvent` answers false when the click was stopped: the browser follows nothing.
    expect(fireEvent.click(c.querySelector('a')!)).toBe(false)
  })
})

/**
 * A person's chip leads to their DM — RIC-16.
 *
 * Miky, after the first pointer mention on production: *"It only creates a
 * label, but not really a link to the mentioned thing"* — and, once it did
 * link: *"It opens the reply thread panel"*, because the card under the chip
 * opens its thread on any click. So there are two things to prove: that the
 * chip is a real link, and that following it is not also a click on the card.
 */
describe('Reference, as a link (RIC-16)', () => {
  const PERSON_URI = `nostr:${encodeNpub(KNOWN)}`

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

  it('a person chip is a link to their DM, by pubkey (REM-3)', () => {
    const c = render(<Reference uri={PERSON_URI} />).container
    expect(c.querySelector('a')?.getAttribute('href')).toBe(`/app/people/${KNOWN}`)
  })

  it('a key nobody could name leads nowhere: it is not a link', () => {
    expect(render(<Reference uri={`nostr:${encodeNpub(STRANGER)}`} />).container.querySelector('a')).toBeNull()
  })

  it('following a chip is not a click on the card under it', () => {
    const card = vi.fn()
    const c = routed(
      <div onClick={card}>
        <Reference uri={PERSON_URI} />
      </div>,
    ).container
    const a = c.querySelector('a')!
    // The card's own test for "not mine", and the event never reaching it.
    expect(a.hasAttribute('data-interactive')).toBe(true)
    fireEvent.click(a)
    expect(card).not.toHaveBeenCalled()
  })

  it('a plain click opens the DM in place; a modified click is left to the browser', () => {
    const r = routed(<Reference uri={PERSON_URI} />)
    const a = r.container.querySelector('a')!
    expect(fireEvent.click(a, { ctrlKey: true })).toBe(true) // default not prevented: open in new tab
    expect(r.getByTestId('where').textContent).toBe('/topics')
    expect(fireEvent.click(a)).toBe(false)
    expect(r.getByTestId('where').textContent).toBe(`/app/people/${KNOWN}`)
  })

  it('draws no glyph on a person', () => {
    const c = render(<Reference uri={PERSON_URI} />).container
    expect(c.querySelector('svg')).toBeNull()
  })
})
