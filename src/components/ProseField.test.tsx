/**
 * A prose field is controlled by the launcher's draft (MAN-1, RIC-13): a value
 * arriving from outside — a prefill from the conversation (PEE-5) — loads into
 * the editor as formatting, not as the markers that spell it.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
})
