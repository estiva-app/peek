/**
 * PRO-4 — a live manifest's action, drawn by the form the launcher already has.
 *
 * The bar `launcherActions.ts` set for this: *"swapping this constant for a
 * live read must not reshape any UI."* So these assert the conversion, and the
 * component test beside them asserts the panel renders it unchanged.
 */
import { describe, expect, it } from 'vitest'
import type { ResolvedAction } from '@estiva-app/interop'
import { parseBlockDocument } from '@estiva-app/protocol'
import { PARENT_FIELD, launcherActionFrom, proseSubmission, splitSubmission, vocabulariesFrom } from './liveAction'

/** Exactly what the runtime returns for Ship's live `add-issue`. */
const addIssue: ResolvedAction = {
  id: 'add-issue',
  label: 'Add issue',
  description: 'File a new issue under a project.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'title', type: 'string', required: true }],
  createsUnder: 'self',
}

describe('launcherActionFrom', () => {
  it('draws one field per declared property', () => {
    const action = launcherActionFrom(addIssue, { parentNoun: 'project' })!
    const title = action.fields.find((f) => f.key === 'title')!
    expect(title.control).toBe('string')
    expect(title.required).toBe(true)
    expect(title.label).toBe('Title')
  })

  it('adds the parent, which is not a property and never appears in one', () => {
    /*
      The half of "needs a form *and a parent*" that made these unrenderable.
      It comes from `emits.toAddressOf: 'self'` — surfaced as `createsUnder` —
      and a form drawing only the declared properties would publish an orphan.
    */
    const action = launcherActionFrom(addIssue, { parentNoun: 'project' })!
    const parent = action.fields.find((f) => f.key === PARENT_FIELD)!
    expect(parent.control).toBe('parent')
    expect(parent.required).toBe(true)
    expect(parent.parentNoun).toBe('project')
  })

  it('adds no parent when the action does not create under one', () => {
    const loose = launcherActionFrom({ ...addIssue, createsUnder: undefined })!
    expect(loose.fields.some((f) => f.key === PARENT_FIELD)).toBe(false)
  })

  it('renders a declared vocabulary as a select, already looked up', () => {
    const withEnum: ResolvedAction = {
      ...addIssue,
      fields: [
        { name: 'title', type: 'string', required: true },
        {
          name: 'priority',
          type: 'string',
          required: false,
          options: [
            { value: 'high', label: 'High' },
            { value: 'low', label: 'Low' },
          ],
        },
      ],
    }
    const action = launcherActionFrom(withEnum)!
    const priority = action.fields.find((f) => f.key === 'priority')!
    expect(priority.control).toBe('enum')
    expect(priority.required).toBe(false)
    expect(vocabulariesFrom(withEnum).priority).toEqual([
      { value: 'high', label: 'High' },
      { value: 'low', label: 'Low' },
    ])
  })

  it('never guesses prose — nothing in a manifest distinguishes a long string', () => {
    // Inferring `text` would hand an app a textarea it never asked for.
    const action = launcherActionFrom(addIssue)!
    expect(action.fields.find((f) => f.key === 'title')!.control).not.toBe('text')
  })

  it('refuses anything that is not an object-creating action', () => {
    // A change or a comment is one control, and the launcher is not where it
    // belongs. Returning null is the honest answer, not a half-drawn form.
    expect(launcherActionFrom({ id: 'set-status', label: 'Change status', control: 'select' })).toBeNull()
    expect(launcherActionFrom({ id: 'comment', label: 'Comment', control: 'text' })).toBeNull()
  })

  it('titles a multi-word property readably', () => {
    const action = launcherActionFrom({
      ...addIssue,
      fields: [{ name: 'dueDate', type: 'string', required: false }],
    })!
    expect(action.fields[0].label).toBe('Due date')
  })
})

describe('splitSubmission', () => {
  it('keeps the parent out of the properties', () => {
    /*
      The runtime refuses any key the manifest did not declare — the check that
      keeps junk out of a shared record. Leaving the synthetic parent field in
      would make Peek trip that check on every submission, and "work around it"
      is the wrong repair.
    */
    const { parent, properties } = splitSubmission({ title: 'Billing entry', [PARENT_FIELD]: '30850:abc:p1' })
    expect(parent).toBe('30850:abc:p1')
    expect(properties).toEqual({ title: 'Billing entry' })
  })

  it('reports no parent rather than an empty one', () => {
    expect(splitSubmission({ title: 'x' }).parent).toBeUndefined()
  })
})

/** Ship's `add-issue` once its description declares a block document (MAN-1). */
const addIssueWithProse: ResolvedAction = {
  ...addIssue,
  fields: [
    { name: 'title', type: 'string', required: true },
    { name: 'description', type: 'string', required: false, target: 'content', format: 'estiva-blocks-1' },
  ],
}

describe('a prose field (MAN-1, RIC-13)', () => {
  it('is drawn as the editor only because the manifest declared the format', () => {
    const prose = launcherActionFrom(addIssueWithProse)!.fields.find((f) => f.key === 'description')!
    expect(prose.control).toBe('prose')
    expect(prose.required).toBe(false)

    // The same field without the format stays a plain textarea.
    const plain = launcherActionFrom({
      ...addIssue,
      fields: [{ name: 'description', type: 'string', required: false, target: 'content' }],
    })!
    expect(plain.fields[0].control).toBe('text')
  })

  it('leaves as a block document, with the format to tag it', () => {
    const action = launcherActionFrom(addIssueWithProse)!
    const { properties, contentFormat } = proseSubmission(action, {
      title: 'Billing entry',
      description: '# Why\nThe **total** is wrong\n- once\n- twice',
    })
    expect(contentFormat).toBe('estiva-blocks-1')
    expect(properties.title).toBe('Billing entry')
    const document = parseBlockDocument(properties.description!)
    expect(document.content.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bulletList'])
    expect(JSON.stringify(document)).toContain('"marks":[{"type":"bold"}]')
  })

  it('sends a title-only capture exactly as before — no body, no format', () => {
    const action = launcherActionFrom(addIssueWithProse)!
    expect(proseSubmission(action, { title: 'Billing entry' })).toEqual({ properties: { title: 'Billing entry' } })
    expect(proseSubmission(action, { title: 'x', description: '  \n' }).contentFormat).toBeUndefined()
  })
})
