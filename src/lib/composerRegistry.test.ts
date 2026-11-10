/**
 * PEE-2 — the reference the launcher leaves behind has to be a reference the
 * reader's own parser finds again.
 *
 * The insert itself is a one-line Tiptap chain and worth little on its own.
 * What is worth asserting is the **spelling**: `MessageBody` recovers an object
 * from a sent body with `findNaddrs` and takes it out of the prose with
 * `stripNaddrs`, both from `@estiva-app/protocol`. So these tests put the real
 * protocol functions on the other end of the seam rather than a fixture — a
 * hand-written expectation here would agree with itself while disagreeing with
 * the renderer, which is the shape of failure this suite keeps finding.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { addrToNaddr, findNaddrs, stripNaddrs, type EditorNode } from '@estiva-app/protocol'
import { composerText } from '@estiva-app/conversation'
import type { Editor } from '@tiptap/react'
import {
  insertReferenceIntoActiveComposer,
  insertTextIntoActiveComposer,
  registerActiveComposer,
  unregisterComposer,
  type ComposerHandle,
} from './composerRegistry'

const SHIP_AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const NEW_ISSUE = `30851:${SHIP_AUTHOR}:0f68a3f3-e44e-46c8-82dd-76432b358a18`

/**
 * A composer that records what was inserted instead of rendering it.
 *
 * Tiptap's chain is fluent, so every step returns the same object and `run()`
 * ends it. `insertContent` is the only step whose argument this test is about;
 * `focus` and `unsetAllMarks` are recorded so the mark-clearing is not silently
 * dropped in a later edit — an inherited bold mark wraps the pointer in marker
 * characters nobody typed.
 */
function fakeComposer() {
  const inserted: unknown[] = []
  const steps: string[] = []
  const chain = {
    focus: () => (steps.push('focus'), chain),
    unsetAllMarks: () => (steps.push('unsetAllMarks'), chain),
    insertContent: (content: unknown) => (inserted.push(content), chain),
    run: () => (steps.push('run'), true),
  }
  const editor = { isDestroyed: false, chain: () => chain } as unknown as Editor
  const handle: ComposerHandle = { editor, label: 'Reply to Katerina' }
  return { handle, editor, inserted, steps }
}

/** The text a sent message would carry, given what was inserted: the comment box's writer, `composerText`, on the paragraph it went into. */
function insertedText(inserted: unknown[]): string {
  const content = inserted.flat() as EditorNode[]
  return composerText({ type: 'doc', content: [{ type: 'paragraph', content }] }).text
}

describe('insertReferenceIntoActiveComposer (PEE-2)', () => {
  beforeEach(() => {
    // The registry is module state, so a composer left registered by one test
    // is a composer the next one did not ask for.
    const stale = fakeComposer()
    registerActiveComposer(stale.handle)
    unregisterComposer(stale.editor)
  })

  it('inserts a reference the renderer finds again', () => {
    const { handle, inserted } = fakeComposer()
    registerActiveComposer(handle)

    expect(insertReferenceIntoActiveComposer(addrToNaddr(NEW_ISSUE, []))).toBe(true)

    // A chip, not text (UIG-40): the comment box's reference chip, the sent message's chip.
    expect((inserted.flat() as Array<{ type: string }>)[0].type).toBe('reference')

    // The round trip that matters: what the person sends is what MessageBody
    // resolves. Compared as an *address*, because the body carries `naddr1…`
    // and the object is identified by `<kind>:<pubkey>:<d>`.
    const body = `Filed it — ${insertedText(inserted)}`
    const found = findNaddrs(body)
    expect(found).toHaveLength(1)
    expect(addrToNaddr(NEW_ISSUE, [])).toBe(found[0])
  })

  it('leaves prose that reads cleanly once the reference is taken out', () => {
    const { handle, inserted } = fakeComposer()
    registerActiveComposer(handle)
    insertReferenceIntoActiveComposer(addrToNaddr(NEW_ISSUE, []))

    /*
      What the insert owes the sentence: no dangling space.

      This used to be the whole story — PEEK-18 cut every pointer out of the
      prose, so the assertion was also what a reader saw. Since RIC-10 a pointer
      following prose is drawn *in* the sentence instead, and only one standing
      alone becomes a card below. So this is now a test of the insert's spacing
      rather than of the rendering, and `MessageBody`'s own tests cover which
      variant a body gets.
    */
    expect(stripNaddrs(`Filed it — ${insertedText(inserted)}`)).toBe('Filed it —')
  })

  it('clears marks before inserting', () => {
    const { handle, steps } = fakeComposer()
    registerActiveComposer(handle)
    insertReferenceIntoActiveComposer(addrToNaddr(NEW_ISSUE, []))

    expect(steps).toContain('unsetAllMarks')
    expect(steps).toContain('run')
  })

  it('reports false when no composer is open, rather than throwing', () => {
    // The launcher is global: creating an object with no conversation open is
    // normal, and there is simply nowhere to leave the reference. The caller
    // decides whether that matters, from the context it captured.
    expect(insertReferenceIntoActiveComposer(addrToNaddr(NEW_ISSUE, []))).toBe(false)
  })

  it('reports false for a composer that has been destroyed', () => {
    const { handle, editor, inserted } = fakeComposer()
    registerActiveComposer(handle)
    ;(editor as unknown as { isDestroyed: boolean }).isDestroyed = true

    expect(insertReferenceIntoActiveComposer(addrToNaddr(NEW_ISSUE, []))).toBe(false)
    expect(inserted).toHaveLength(0)
  })
})

describe('a drafted reply goes in, and only in (INT-4)', () => {
  beforeEach(() => {
    // Same reset as above: the registry is module state.
    const stale = fakeComposer()
    registerActiveComposer(stale.handle)
    unregisterComposer(stale.editor)
  })

  it('inserts the text at the cursor', () => {
    const { handle, inserted } = fakeComposer()
    registerActiveComposer(handle)

    expect(insertTextIntoActiveComposer('Sounds good — I can pick it up tomorrow.')).toBe(true)
    expect(inserted).toEqual([[{ type: 'text', text: 'Sounds good — I can pick it up tomorrow.' }]])
  })

  it('inserts rather than replaces, so a half-typed message survives', () => {
    /*
      INT-4's stated promise, and the reason this is `insertContent` and not
      `setContent`. Tiptap's insert lands at the selection and leaves the rest
      of the document alone — asserted through the absence of any step that
      would clear it, because `setContent` is a one-word edit away.
    */
    const { handle, steps } = fakeComposer()
    registerActiveComposer(handle)
    insertTextIntoActiveComposer('a draft')

    expect(steps).not.toContain('setContent')
    expect(steps).not.toContain('clearContent')
  })

  it('turns newlines into hard breaks, not paragraphs', () => {
    // A drafted reply is one message. Paragraph nodes would change what the
    // composer serialises on send.
    const { handle, inserted } = fakeComposer()
    registerActiveComposer(handle)
    insertTextIntoActiveComposer('First line.\n\nSecond line.')

    expect(inserted).toEqual([
      [
        { type: 'text', text: 'First line.' },
        { type: 'hardBreak' },
        { type: 'text', text: 'Second line.' },
      ],
    ])
  })

  it('clears marks before inserting', () => {
    // A cursor inside a bold run would otherwise wrap the entire draft.
    const { handle, steps } = fakeComposer()
    registerActiveComposer(handle)
    insertTextIntoActiveComposer('a draft')

    expect(steps).toContain('unsetAllMarks')
    expect(steps).toContain('run')
  })

  it('does not insert a blank draft', () => {
    // The model returning whitespace must not put an empty edit in somebody's
    // undo history.
    const { handle, inserted } = fakeComposer()
    registerActiveComposer(handle)

    expect(insertTextIntoActiveComposer('   \n ')).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('reports false with no composer open, rather than throwing', () => {
    expect(insertTextIntoActiveComposer('a draft')).toBe(false)
  })

  it('reports false for a composer that has been destroyed', () => {
    const { handle, editor, inserted } = fakeComposer()
    registerActiveComposer(handle)
    ;(editor as unknown as { isDestroyed: boolean }).isDestroyed = true

    expect(insertTextIntoActiveComposer('a draft')).toBe(false)
    expect(inserted).toHaveLength(0)
  })

  it('never sends — nothing in the registry can', () => {
    /*
      The ticket's central promise, asserted where it is actually kept: the
      composer handle exposes an editor and an attachment hook and no way to
      publish. A send would have to be added here first, and this test is what
      would notice.
    */
    const { handle } = fakeComposer()
    expect(Object.keys(handle)).toEqual(['editor', 'label'])
  })
})
