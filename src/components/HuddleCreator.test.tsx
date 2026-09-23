/**
 * The huddle's "To:" field is the shared people picker (ADOPTION P14, stage 5,
 * 2026-09-13), and moving onto it put one thing at risk that nothing else
 * would catch: the suggestion list is portalled to the body, outside this
 * component's box, and this component cancels the whole huddle on a click
 * outside that box. A click on a person must not cancel it.
 *
 * Also pinned: Escape clears a half-typed name before it cancels, and the
 * first message is created with the recipients' names, as `onCreate` has
 * always received them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@estiva-app/ui'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { ToastProvider } from '@/lib/toast'
import { HuddleCreator } from './HuddleCreator'

afterEach(cleanup)

function renderCreator(onCancel = vi.fn(), onCreate = vi.fn()) {
  render(
    <DebugProvider>
      <PeekDataProvider>
        <ToastProvider>
          <TooltipProvider>
            <HuddleCreator topicTitle="A topic" onCancel={onCancel} onCreate={onCreate} />
          </TooltipProvider>
        </ToastProvider>
      </PeekDataProvider>
    </DebugProvider>,
  )
  return { onCancel, onCreate }
}

describe('HuddleCreator', () => {
  it('shows no people until you type', async () => {
    const user = userEvent.setup()
    renderCreator()
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('a click on a suggested person adds them and does not cancel the huddle', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderCreator()
    await user.type(screen.getByRole('combobox'), 'a')
    const option = (await screen.findAllByRole('option'))[0]
    // The document listener the creator uses for "clicked away" is a
    // mousedown — fire exactly that on the portalled row.
    fireEvent.mouseDown(option)
    await user.click(option)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
  })

  it('a click genuinely outside cancels it', () => {
    const { onCancel } = renderCreator()
    fireEvent.mouseDown(document.body)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape clears a half-typed name first, and cancels only when there is nothing to clear', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderCreator()
    const input = screen.getByRole('combobox') as HTMLInputElement
    await user.type(input, 'a')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    expect(input.value).toBe('')
    expect(onCancel).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
