/**
 * PEE-3 — converting a field-setting action into the one control it is.
 *
 * `launcherActionFrom` returns null for these on purpose, and said why: *"a
 * change or a comment is one control and the launcher is not where it
 * belongs."* That held while there was nothing to apply a change *to*. PEE-3
 * supplies the target — the objects the conversation already refers to — so the
 * action and its target are resolved together, and `changeActionFrom` converts
 * that pair. The earlier point survives in the shape: one field, never a form.
 */
import { describe, expect, it } from 'vitest'
import type { ResolvedAction } from '@estiva-app/interop'
import { changeActionFrom, changeVocabulariesFrom, launcherActionFrom } from './liveAction'

const TARGET = { address: 'naddr1example', label: 'Billing entry' }

/** Ship's `set-issue-status`, as the runtime resolves it. */
const setStatus: ResolvedAction = {
  id: 'set-issue-status',
  label: 'Set status',
  control: 'select',
  effect: 'writes',
  field: 'status',
  current: 'in_progress',
  options: [
    { value: 'todo', label: 'Todo' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'done', label: 'Done' },
  ],
}

/** Ship's `assign-issue`. */
const assign: ResolvedAction = {
  id: 'assign-issue',
  label: 'Assign',
  control: 'pubkey',
  effect: 'writes',
  field: 'assignee',
}

describe('changeActionFrom', () => {
  it('draws one control, not a form', () => {
    const action = changeActionFrom(setStatus, TARGET)
    expect(action?.fields).toHaveLength(1)
    expect(action?.fields[0].control).toBe('enum')
  })

  it('carries the target, which is what makes it a change rather than a creation', () => {
    // `submitAction` branches on this: a target means a scalar to an existing
    // object, its absence means a property bag under a parent.
    const action = changeActionFrom(setStatus, TARGET)
    expect(action?.target).toBe('naddr1example')
    expect(action?.targetLabel).toBe('Billing entry')
  })

  it('opens on the value the object actually has', () => {
    /*
      `current` rather than the vocabulary's first entry. A status picker that
      opens on "Todo" for an issue that is in progress invites somebody to
      publish a change they did not mean — and it publishes a real event to a
      shared record.
    */
    expect(changeActionFrom(setStatus, TARGET)?.fields[0].defaultValue).toBe('in_progress')
  })

  it('falls back to the first option when the object has no current value', () => {
    const noCurrent: ResolvedAction = { ...setStatus }
    delete noCurrent.current
    expect(changeActionFrom(noCurrent, TARGET)?.fields[0].defaultValue).toBe('todo')
  })

  it('uses the manifest field name as the key, so the runtime recognises it', () => {
    expect(changeActionFrom(setStatus, TARGET)?.fields[0].key).toBe('status')
  })

  it('draws a person picker for a pubkey action', () => {
    const action = changeActionFrom(assign, TARGET)
    expect(action?.fields[0].control).toBe('pubkey')
    expect(action?.fields[0].key).toBe('assignee')
  })

  it('refuses a select with no vocabulary rather than drawing an empty picker', () => {
    // A row that opens onto a select with nothing in it is a row that cannot
    // succeed, which the launcher's own rule forbids.
    const noOptions: ResolvedAction = { ...setStatus }
    delete noOptions.options
    expect(changeActionFrom(noOptions, TARGET)).toBeNull()
  })

  it('refuses a comment box, which belongs in the thread', () => {
    const comment: ResolvedAction = { id: 'comment', label: 'Comment', control: 'text' }
    expect(changeActionFrom(comment, TARGET)).toBeNull()
  })

  it('refuses an object-creating action — that is the other converter', () => {
    const create: ResolvedAction = {
      id: 'add-issue',
      label: 'Add issue',
      control: 'form',
      fields: [{ name: 'title', type: 'string', required: true }],
      createsUnder: 'self',
    }
    expect(changeActionFrom(create, TARGET)).toBeNull()
    // And the two converters stay disjoint in the other direction.
    expect(launcherActionFrom(setStatus)).toBeNull()
    expect(launcherActionFrom(create)).not.toBeNull()
  })
})

describe('changeVocabulariesFrom', () => {
  it('keys the vocabulary by the field key the form looks up', () => {
    expect(changeVocabulariesFrom(setStatus)).toEqual({
      status: [
        { value: 'todo', label: 'Todo' },
        { value: 'in_progress', label: 'In progress' },
        { value: 'done', label: 'Done' },
      ],
    })
  })

  it('is empty for an action with no vocabulary', () => {
    expect(changeVocabulariesFrom(assign)).toEqual({})
  })
})
