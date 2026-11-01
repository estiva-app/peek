/**
 * FOL-46 in Peek: the archive question, the notice an archived file opens
 * under, and Archive offered where a topic's deletion is asked.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArchiveDialog } from './ArchiveDialog'
import { ConfirmDelete } from './ConfirmDelete'

describe('ArchiveDialog', () => {
  it('says what goes with the file, counted, and archives with the resolution typed', async () => {
    const onArchive = vi.fn(async () => true)
    render(
      <ArchiveDialog
        title="Probe project"
        what="project"
        hides={['2 issues']}
        staysVisible={['1 file also in Steer']}
        onClose={() => {}}
        onArchive={onArchive}
      />,
    )
    expect(screen.getByText('This hides the project and 2 issues from every list, in Peek and in Ship.')).toBeInTheDocument()
    expect(screen.getByText('1 file also in Steer stay visible there.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Resolution (optional)'), '  Shipped in 0.37.  ')
    await userEvent.click(screen.getByRole('button', { name: 'Archive project' }))
    expect(onArchive).toHaveBeenCalledWith('Shipped in 0.37.')
  })

  it('archives from the resolution with Ctrl+Enter, and closes when it is done', async () => {
    const onArchive = vi.fn(async () => true)
    const onClose = vi.fn()
    render(<ArchiveDialog title="T" what="topic" hides={[]} onClose={onClose} onArchive={onArchive} />)
    await userEvent.type(screen.getByLabelText('Resolution (optional)'), 'Merged{Control>}{Enter}{/Control}')
    expect(onArchive).toHaveBeenCalledWith('Merged')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('stays open when the archive is refused', async () => {
    const onClose = vi.fn()
    render(<ArchiveDialog title="T" what="topic" hides={[]} onClose={onClose} onArchive={async () => false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Archive topic' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Archive topic' })).toBeEnabled()
  })

  it('closes on Escape, even with the cursor in the resolution', async () => {
    const onClose = vi.fn()
    render(<ArchiveDialog title="T" what="topic" hides={[]} onClose={onClose} onArchive={async () => true} />)
    await userEvent.type(screen.getByLabelText('Resolution (optional)'), 'half a thought{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('hides only the file when nothing is under it', () => {
    render(<ArchiveDialog title="T" what="topic" hides={[]} onClose={() => {}} onArchive={async () => true} />)
    expect(screen.getByText('This hides the topic from every list, in Peek and in Ship.')).toBeInTheDocument()
  })
})

describe('ConfirmDelete', () => {
  it('offers Archive instead for a topic that can be archived', async () => {
    const onArchiveInstead = vi.fn()
    render(<ConfirmDelete onArchiveInstead={onArchiveInstead} onConfirm={() => {}} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Archive instead' }))
    expect(onArchiveInstead).toHaveBeenCalled()
  })

  it('offers nothing more where there is no archive', () => {
    render(<ConfirmDelete onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Archive instead' })).toBeNull()
  })

  it('opens before the count is in: says it is counting, and Archive waits for it', () => {
    render(<ArchiveDialog title="T" what="folder" hides={null} onClose={() => {}} onArchive={async () => true} />)
    expect(screen.getByText('Counting what archiving this folder would hide…')).not.toBeNull()
    expect((screen.getByRole('button', { name: 'Archive folder' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
