import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FOLDER_HERE, PICKER_FOLDERS, SHIP_PROJECT, STATELESS_FOLDER } from '@/api/fixtures'
import { MoveFileDialog } from './MoveFileDialog'

/**
 * FOL-10: a Folder with no state is never a destination. A move into one emits
 * state listing only the moved file, and everything already filed there stops
 * being listed — so the dialog does not offer it, and the planner refuses it.
 */
describe('MoveFileDialog', () => {
  const here = PICKER_FOLDERS[0]!
  const feedback = PICKER_FOLDERS[1]!

  it('says there is nowhere to go when every other Folder has no state', () => {
    render(<MoveFileDialog file={SHIP_PROJECT} from={FOLDER_HERE} folders={[here, STATELESS_FOLDER]} onMove={vi.fn()} onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Move to folder' })
    expect(within(dialog).getByText('There is no other folder it can be moved to.')).toBeInTheDocument()
    expect(within(dialog).queryByText(STATELESS_FOLDER.name!)).not.toBeInTheDocument()
  })

  it('moves to a Folder with state, even when a stateless one is listed first', async () => {
    const user = userEvent.setup()
    const onMove = vi.fn(async () => true)
    render(
      <MoveFileDialog
        file={SHIP_PROJECT}
        from={FOLDER_HERE}
        folders={[STATELESS_FOLDER, here, feedback]}
        onMove={onMove}
        onClose={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Move' }))

    expect(onMove).toHaveBeenCalledWith(feedback.id)
    expect(onMove).not.toHaveBeenCalledWith(STATELESS_FOLDER.id)
  })
})
