import { describe, expect, it } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { fileControlsOf, hasFileControls } from './fileControls'

/**
 * The gate behind a file's Rename and Delete (FOL-33): read off the manifest's
 * resolved actions, never off the kind. The fixtures carry production's kinds
 * so that a kind check would pass the wrong one.
 */
type Loose = Omit<Partial<ForeignObject>, 'actions' | 'slots'> & { actions?: object[]; slots?: object }
const file = (over: Loose): ForeignObject =>
  ({ naddr: 'naddr1x', slots: { title: { value: 'T', field: 'title' } }, actions: [], ...over }) as unknown as ForeignObject

const rename = { id: 'rename', label: 'Rename', control: 'text', field: 'title' }
const remove = { id: 'delete', label: 'Delete', control: 'confirm', effect: 'destructive' }

describe('fileControlsOf', () => {
  it('a bare file whose manifest declares rename and delete offers both, by their ids', () => {
    const controls = fileControlsOf(file({ kind: 30840, actions: [{ id: 'comment', control: 'text' }, rename, remove] }))
    expect(controls.rename?.id).toBe('rename')
    expect(controls.delete?.id).toBe('delete')
    expect(hasFileControls(controls)).toBe(true)
  })

  it('a Ship issue whose manifest declares a status change and a comment offers neither', () => {
    const controls = fileControlsOf(
      file({
        kind: 30851,
        actions: [
          { id: 'set-issue-status', control: 'select', field: 'status', options: [] },
          { id: 'comment', control: 'text' },
        ],
      }),
    )
    expect(controls).toEqual({})
    expect(hasFileControls(controls)).toBe(false)
  })

  it('a kind-30840 object whose actions say nothing offers nothing — the kind is not the gate', () => {
    expect(fileControlsOf(file({ kind: 30840, actions: [{ id: 'comment', control: 'text' }] }))).toEqual({})
  })

  it('rename is the action that sets the title’s field, whatever it is called (PEEK-18)', () => {
    const controls = fileControlsOf(
      file({
        kind: 31801,
        slots: { title: { value: 'T', field: 'name' } },
        actions: [{ id: 'set-name', label: 'Set name', control: 'text', field: 'name' }],
      }),
    )
    expect(controls.rename?.id).toBe('set-name')
  })

  it('a text action on some other field is not a rename', () => {
    const controls = fileControlsOf(file({ actions: [{ id: 'set-note', control: 'text', field: 'note' }] }))
    expect(controls.rename).toBeUndefined()
  })

  it('no address, no controls, whatever the actions say', () => {
    expect(fileControlsOf(file({ naddr: undefined, actions: [rename, remove] }))).toEqual({})
    expect(fileControlsOf(null)).toEqual({})
  })

  it('archive is the action setting `archived`, whatever each app called it (FOL-46)', () => {
    const issue = fileControlsOf(
      file({ kind: 30851, actions: [{ id: 'archive-issue', control: 'select', field: 'archived', options: [] }] }),
    )
    expect(issue.archive?.id).toBe('archive-issue')
    expect(hasFileControls(issue)).toBe(true)
    const topic = fileControlsOf(
      file({ kind: 30840, actions: [rename, { id: 'archive', control: 'select', field: 'archived', options: [] }] }),
    )
    expect(topic.archive?.id).toBe('archive')
  })

  it('a manifest with no archive action offers no Archive', () => {
    expect(fileControlsOf(file({ kind: 30840, actions: [rename, remove] })).archive).toBeUndefined()
  })
})
