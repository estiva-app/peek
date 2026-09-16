import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { AddToOpenWorkDialog } from './AddToOpenWorkDialog'

/**
 * UIG-8: each row is the package Checkbox's row (Katerina's pick B), not a
 * hand-made `role="option"` in a list that was not one. What that changes for a
 * person: every row is a tick box named by its title, reached with Tab and
 * ticked with Space as well as by a click anywhere on it.
 */
describe('AddToOpenWorkDialog', () => {
  it('ticks a topic from a click on its row or Space on its box, and adds every pick', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(
      <DebugProvider>
        <PeekDataProvider>
          <AddToOpenWorkDialog onAdd={onAdd} onClose={onClose} />
        </PeekDataProvider>
      </DebugProvider>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Add to Open work' })
    expect(within(dialog).queryAllByRole('option')).toHaveLength(0)
    expect(within(dialog).getByRole('button', { name: 'Add topic' })).toBeDisabled()

    await user.click(within(dialog).getByText('Show your pet!'))
    expect(within(dialog).getByRole('checkbox', { name: 'Show your pet!' })).toHaveAttribute('aria-checked', 'true')

    within(dialog).getByRole('checkbox', { name: 'Updates on the new office layout' }).focus()
    await user.keyboard(' ')
    expect(within(dialog).getByRole('checkbox', { name: 'Updates on the new office layout' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(dialog).getByRole('button', { name: 'Add 2 topics' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd.mock.calls[0][0]).toHaveLength(2)
    expect(onClose).toHaveBeenCalled()
  })
})
