/**
 * The type-ahead popups are listboxes, and the editor is the field they
 * complete (ADOPTION P28, stage 5).
 *
 * jsdom cannot type into ProseMirror, so this drives the shell directly: a
 * plain element stands in for `editor.view.dom`, and the rows move their
 * `aria-selected` the way a menu's highlight does. What is pinned is the
 * contract the three menus rely on — they only mark their rows, and the shell
 * keeps the editor's attributes in step — including that nothing is left on
 * the editor once the popup is gone. The real editor is proved in Chrome
 * through the stories that type `/`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { SuggestionPopover } from './SuggestionPopover'

afterEach(cleanup)

const RECT = { top: 400, bottom: 420, left: 100, right: 110, width: 10, height: 20, x: 100, y: 400, toJSON: () => ({}) } as DOMRect

function Rows({ active }: { active: number }) {
  return (
    <>
      {['One', 'Two', 'Three'].map((label, i) => (
        <button key={label} type="button" role="option" id={`row-${i}`} aria-selected={i === active} tabIndex={-1}>
          {label}
        </button>
      ))}
    </>
  )
}

function Harness({ editor, open = true }: { editor: HTMLElement; open?: boolean }) {
  const [active, setActive] = useState(0)
  return (
    <>
      <button type="button" onClick={() => setActive((a) => a + 1)}>
        next
      </button>
      {open && (
        <SuggestionPopover rect={RECT} width="w-[300px]" maxHeight="max-h-[400px]" ariaLabel="Commands" editorElement={editor}>
          <Rows active={active} />
        </SuggestionPopover>
      )}
    </>
  )
}

describe('SuggestionPopover', () => {
  it('is a named listbox of options', async () => {
    const editor = document.createElement('div')
    render(<Harness editor={editor} />)
    const listbox = await screen.findByRole('listbox', { name: 'Commands' })
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(listbox.id).toBeTruthy()
  })

  it('tells the editor it completes into that list, and which row is active', async () => {
    const editor = document.createElement('div')
    render(<Harness editor={editor} />)
    const listbox = await screen.findByRole('listbox')
    expect(editor.getAttribute('aria-autocomplete')).toBe('list')
    expect(editor.getAttribute('aria-haspopup')).toBe('listbox')
    expect(editor.getAttribute('aria-controls')).toBe(listbox.id)
    expect(editor.getAttribute('aria-activedescendant')).toBe('row-0')
  })

  it('moves aria-activedescendant when the highlight moves', async () => {
    const editor = document.createElement('div')
    render(<Harness editor={editor} />)
    await screen.findByRole('listbox')
    await act(async () => {
      screen.getByRole('button', { name: 'next' }).click()
    })
    // The shell follows the attribute with a MutationObserver, which reports
    // after the change — give it the microtask it needs.
    await act(async () => {})
    expect(editor.getAttribute('aria-activedescendant')).toBe('row-1')
  })

  it('leaves nothing on the editor once the popup closes', async () => {
    const editor = document.createElement('div')
    const { rerender } = render(<Harness editor={editor} />)
    await screen.findByRole('listbox')
    rerender(<Harness editor={editor} open={false} />)
    for (const name of ['aria-autocomplete', 'aria-haspopup', 'aria-controls', 'aria-activedescendant']) {
      expect(editor.hasAttribute(name)).toBe(false)
    }
  })

  it('draws the list without an editor — the stories do', async () => {
    render(
      <SuggestionPopover rect={RECT} width="w-[300px]" maxHeight="max-h-[400px]" ariaLabel="People">
        <Rows active={0} />
      </SuggestionPopover>,
    )
    expect(await screen.findByRole('listbox', { name: 'People' })).toBeTruthy()
  })
})
