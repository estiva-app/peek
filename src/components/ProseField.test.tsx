/**
 * A prose field is controlled by the launcher's draft (MAN-1, RIC-13): a value
 * arriving from outside — a prefill from the conversation (PEE-5) — loads into
 * the editor as formatting, not as the markers that spell it.
 */
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ProseField } from './ProseField'

describe('ProseField', () => {
  it('loads a prefill as formatted text, without handing it back as an edit', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ProseField value="" onChange={onChange} label="Description" />)
    const editor = await screen.findByRole('textbox', { name: 'Description' })

    rerender(<ProseField value={'The **total** is wrong'} onChange={onChange} label="Description" />)

    await waitFor(() => expect(editor.querySelector('strong')?.textContent).toBe('total'))
    expect(editor.textContent).toBe('The total is wrong')
    // A suggestion is not the person typing — `applyPrefill` depends on that.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not reload an older edit of its own that arrives late', async () => {
    /*
      Production, RIC-13's probe: keys pressed back-to-back reached the editor
      before the draft from the previous key came back, and that older value
      was loaded over the newer text — the bold vanished. Two edits, then the
      first comes round as `value`.
    */
    const onChange = vi.fn()
    const { rerender } = render(<ProseField value="" onChange={onChange} label="Description" />)
    const dom = (await screen.findByRole('textbox', { name: 'Description' })) as HTMLElement & {
      editor?: { commands: { insertContent: (s: string) => void; selectAll: () => void; toggleBold: () => void } }
    }
    act(() => dom.editor!.commands.insertContent('abc'))
    act(() => {
      dom.editor!.commands.selectAll()
      dom.editor!.commands.toggleBold()
    })
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['abc', '**abc**'])

    rerender(<ProseField value="abc" onChange={onChange} label="Description" />)
    expect(dom.querySelector('strong')?.textContent).toBe('abc')

    // The draft catches up, and a genuine outside value still loads after it.
    rerender(<ProseField value="**abc**" onChange={onChange} label="Description" />)
    rerender(<ProseField value="From the thread" onChange={onChange} label="Description" />)
    await waitFor(() => expect(dom.textContent).toBe('From the thread'))
  })

  it('keeps a quick Backspace when the text it undid comes round late', async () => {
    // `a`, `ab`, `a`: the string repeats, so matching emissions by string
    // alone let the late `ab` back in and undid the Backspace.
    const onChange = vi.fn()
    const { rerender } = render(<ProseField value="" onChange={onChange} label="Description" />)
    const dom = (await screen.findByRole('textbox', { name: 'Description' })) as HTMLElement & {
      editor?: { commands: { insertContent: (s: string) => void; deleteRange: (r: { from: number; to: number }) => void }; getText: () => string }
    }
    act(() => dom.editor!.commands.insertContent('a'))
    act(() => dom.editor!.commands.insertContent('b'))
    act(() => dom.editor!.commands.deleteRange({ from: 2, to: 3 }))
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['a', 'ab', 'a'])

    rerender(<ProseField value="a" onChange={onChange} label="Description" />)
    rerender(<ProseField value="ab" onChange={onChange} label="Description" />)
    expect(dom.editor!.getText()).toBe('a')
    rerender(<ProseField value="a" onChange={onChange} label="Description" />)
    expect(dom.editor!.getText()).toBe('a')
  })
})
