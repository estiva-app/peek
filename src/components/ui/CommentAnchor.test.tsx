/**
 * Which part of another app's object a comment is about — SPEC §13.6.
 *
 * This is the half RIC-7 says proves anything: one app anchoring and reading
 * its own comments demonstrates nothing about the protocol. Peek does not know
 * what a Ship description is — it has the projection, `slots.body` with the
 * format its owner declared, and that has to be enough.
 *
 * The assertions are mostly about the states that are *not* resolved, because
 * §13.6's rule is that they must not look like each other or like a comment
 * with no anchor at all.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'
import {
  blockIds,
  markerTextToBlockDocument,
  serializeBlockDocument,
} from '@estiva-app/protocol'
import { CommentAnchor } from './CommentAnchor'

const document = markerTextToBlockDocument('# Plan\n\nthe paragraph in question\n\nsomething else')
const body = serializeBlockDocument(document)
const [, paragraphId] = blockIds(document)

/** A Ship issue as the projection layer hands it over. */
const shipIssue = (value: string, format?: 'marker' | 'blocks'): ForeignObject =>
  ({ slots: { title: { value: 'An issue' }, body: { value, format } } }) as unknown as ForeignObject

const show = (props: Parameters<typeof CommentAnchor>[0]) =>
  render(<CommentAnchor {...props} />).container

describe('CommentAnchor', () => {
  it('draws nothing when the comment has no anchor', () => {
    expect(show({ blockId: undefined, object: shipIssue(body, 'blocks') }).textContent).toBe('')
  })

  it('quotes the block, using only the projection', () => {
    const c = show({ blockId: paragraphId, object: shipIssue(body, 'blocks') })
    expect(c.querySelector('[data-comment-anchor="resolved"]')).not.toBeNull()
    expect(c.textContent).toContain('the paragraph in question')
  })

  it('says a detached anchor is detached', () => {
    const edited = serializeBlockDocument(
      markerTextToBlockDocument('# Plan\n\nsomething else', document),
    )
    const c = show({ blockId: paragraphId, object: shipIssue(edited, 'blocks') })
    expect(c.querySelector('[data-comment-anchor="detached"]')).not.toBeNull()
    expect(c.textContent).toContain('deleted')
  })

  it('does not claim a deletion when the body simply has no parts', () => {
    // Marker text never had parts (§13.1). Nothing was deleted.
    const c = show({ blockId: paragraphId, object: shipIssue('plain description', 'marker') })
    expect(c.querySelector('[data-comment-anchor="unaddressable"]')).not.toBeNull()
    expect(c.textContent).not.toContain('deleted')
  })

  it('does not claim a deletion when the object has not resolved', () => {
    // Two states that only exist in the *consuming* app. Saying "that paragraph
    // was deleted" about data Peek cannot see would be a confident wrong answer
    // about somebody else's object.
    const c = show({ blockId: paragraphId, object: undefined })
    expect(c.querySelector('[data-comment-anchor="unresolved"]')).not.toBeNull()
    expect(c.textContent).not.toContain('deleted')
  })

  it('does not claim a deletion when the object declares no body slot', () => {
    const noBody = { slots: { title: { value: 'An issue' } } } as unknown as ForeignObject
    const c = show({ blockId: paragraphId, object: noBody })
    expect(c.querySelector('[data-comment-anchor="no-body"]')).not.toBeNull()
    expect(c.textContent).not.toContain('deleted')
  })

  it('never renders two different states identically', () => {
    const edited = serializeBlockDocument(markerTextToBlockDocument('# Plan', document))
    const seen = [
      show({ blockId: paragraphId, object: shipIssue(edited, 'blocks') }).textContent,
      show({ blockId: paragraphId, object: shipIssue('plain', 'marker') }).textContent,
      show({ blockId: paragraphId, object: undefined }).textContent,
      show({ blockId: undefined, object: shipIssue(body, 'blocks') }).textContent,
    ]
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('treats a body with no declared format as marker text — §13.4', () => {
    // The format comes from the owner's declaration. A body that happens to be
    // JSON is still marker text if nothing said otherwise, so the anchor is
    // unaddressable rather than resolvable.
    const c = show({ blockId: paragraphId, object: shipIssue(body, undefined) })
    expect(c.querySelector('[data-comment-anchor="unaddressable"]')).not.toBeNull()
  })
})
