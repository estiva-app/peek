/**
 * FOL-46 in Peek: the archive question, the notice an archived file opens
 * under, and Archive offered where a topic's deletion is asked.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArchiveDialog } from './ArchiveDialog'
import { ArchivedNotice } from './ArchivedNotice'
import { ConfirmDelete } from './ConfirmDelete'

const PROJECT = `30850:${'b'.repeat(64)}:bea1c4f7-cab4-47a1-bb4b-966e20fcf945`

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

  it('hides only the file when nothing is under it', () => {
    render(<ArchiveDialog title="T" what="topic" hides={[]} onClose={() => {}} onArchive={async () => true} />)
    expect(screen.getByText('This hides the topic from every list, in Peek and in Ship.')).toBeInTheDocument()
  })
})

describe('ArchivedNotice', () => {
  it('an archived file shows who archived it and its resolution, and offers Unarchive', async () => {
    const onUnarchive = vi.fn()
    render(<ArchivedNotice archive={{ by: 'x', at: 1_790_000_000, resolution: 'Done.' }} by="QA-1" onUnarchive={onUnarchive} />)
    expect(screen.getByRole('status')).toHaveTextContent('Archived by QA-1')
    expect(screen.getByText('Done.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
    expect(onUnarchive).toHaveBeenCalled()
  })

  it('a file archived with its parent opens the parent rather than offering Unarchive', () => {
    render(
      <ArchivedNotice
        archive={{ by: 'x', at: 1_790_000_000, with: PROJECT }}
        by="QA-1"
        withWhat="project"
        onUnarchive={() => {}}
        onOpenParent={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Archived with its project by QA-1')
    expect(screen.getByRole('button', { name: 'Open project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unarchive' })).toBeNull()
  })
})

describe('ConfirmDelete', () => {
  it('offers Archive instead for a topic that can be archived', async () => {
    const onArchiveInstead = vi.fn()
    render(<ConfirmDelete what="topic" onArchiveInstead={onArchiveInstead} onConfirm={() => {}} onClose={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Archive instead' }))
    expect(onArchiveInstead).toHaveBeenCalled()
  })

  it('offers nothing more where there is no archive', () => {
    render(<ConfirmDelete what="topic" onConfirm={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Archive instead' })).toBeNull()
  })
})
