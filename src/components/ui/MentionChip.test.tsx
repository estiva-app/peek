/**
 * A mention that names a key — SPEC §13.1, RIC-2.
 *
 * The old form was the display name, resolved against Peek's own directory. It
 * had two defects and the second is permanent: another app rendered plain text,
 * and — because message content is immutable — a rename desynchronised the body
 * from its `p` tags for ever.
 *
 * So the cases that matter here are the ones where the directory *cannot* help:
 * an unresolved key must still draw a mention, because saying "somebody" is the
 * correct answer and saying nothing is not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { encodeNpub } from '@estiva-app/protocol'

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

import { MentionChip } from './MentionChip'

describe('MentionChip', () => {
  it('names the person when the directory knows them', () => {
    const c = render(<MentionChip uri={`nostr:${encodeNpub(KNOWN)}`} />).container
    expect(c.textContent).toBe('@Ada Lovelace')
    expect(c.querySelector('[data-resolved="true"]')).not.toBeNull()
  })

  it('still draws a mention for a key it cannot resolve', () => {
    // §13.1: "the URI's own label or its shortened form, never blank." A key
    // from outside this workspace is exactly the case the old form could not
    // represent at all.
    const c = render(<MentionChip uri={`nostr:${encodeNpub(STRANGER)}`} />).container
    expect(c.textContent).not.toBe('')
    expect(c.textContent).toMatch(/^npub1.*…$/)
    expect(c.querySelector('[data-resolved="false"]')).not.toBeNull()
  })

  it('carries the key itself, so what it means does not depend on the label', () => {
    const c = render(<MentionChip uri={`nostr:${encodeNpub(KNOWN)}`} />).container
    expect(c.querySelector(`[data-mention="${KNOWN}"]`)).not.toBeNull()
  })

  it('shows the whole URI on hover when it could not name anyone', () => {
    const uri = `nostr:${encodeNpub(STRANGER)}`
    const c = render(<MentionChip uri={uri} />).container
    expect(c.querySelector('[title]')?.getAttribute('title')).toBe(uri)
  })

  it('leaves a reference that is not a person alone', () => {
    // An naddr names an object; those are drawn as widgets below the text.
    const c = render(<MentionChip uri="nostr:naddr1notavalidone" />).container
    expect(c.textContent).toBe('nostr:naddr1notavalidone')
    expect(c.querySelector('[data-mention]')).toBeNull()
  })

  it('resolves when the directory arrives, without anything else re-rendering', async () => {
    /*
      THE REGRESSION (reported as "my tags are like this lately").

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
    const c = render(<MentionChip uri={stranger} />).container
    expect(c.textContent).toMatch(/^npub1.*…$/)

    directoryArrives([[STRANGER, 'Katerina Kelepouri']])

    expect(c.textContent).toBe('@Katerina Kelepouri')
    expect(c.querySelector('[data-resolved="true"]')).not.toBeNull()
  })
})
