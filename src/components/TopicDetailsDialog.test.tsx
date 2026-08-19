import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopicDetailsDialogView, type TopicDetails } from './TopicDetailsDialog'

/**
 * PEE-2's design decisions, as assertions.
 *
 * Renaming ended up in a dialog rather than in the header title because of two
 * things a header cannot do: refuse the edit to most people without showing
 * them a locked field, and say why the relay said no. Both are pinned here.
 */
const details: TopicDetails = {
  title: 'Feedback on Peek',
  createdAt: Date.parse('2026-08-12T09:20:00Z'),
  createdByName: 'Katerina Kelepouri',
  canRename: true,
  members: [
    { name: 'Katerina Kelepouri', role: 'Product Designer', isCreator: true },
    { name: 'Jan Miky', role: 'Engineering', isCreator: false },
  ],
}

const open = async (props: Partial<React.ComponentProps<typeof TopicDetailsDialogView>> = {}) => {
  render(<TopicDetailsDialogView details={details} onClose={vi.fn()} {...props} />)
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
}

describe('TopicDetailsDialogView', () => {
  it('shows the name as a plain label to someone who cannot rename it', () => {
    render(
      <TopicDetailsDialogView details={{ ...details, canRename: false }} onClose={vi.fn()} onRename={vi.fn()} />,
    )

    expect(screen.getByText('Feedback on Peek')).toBeInTheDocument()
    // Absent, not disabled. A locked field invites an attempt that cannot
    // succeed; a label has nothing to try.
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Topic name' })).not.toBeInTheDocument()
  })

  it('names the creator on their row, so it is clear who to ask', () => {
    render(<TopicDetailsDialogView details={{ ...details, canRename: false }} onClose={vi.fn()} />)

    expect(screen.getByText('Created this topic')).toBeInTheDocument()
  })

  it('will not save a name that has not changed', async () => {
    await open({ onRename: vi.fn() })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('will not save a name that is nothing once the relay has trimmed it', async () => {
    const onRename = vi.fn()
    await open({ onRename })

    const field = screen.getByRole('textbox', { name: 'Topic name' })
    await userEvent.clear(field)
    // Buzz strips leading '#' and surrounding whitespace before storing, so
    // this is an empty name — caught here rather than at the relay.
    await userEvent.type(field, '###  ')

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('saves the name the relay will actually store, not the one typed', async () => {
    const onRename = vi.fn().mockResolvedValue(null)
    await open({ onRename })

    const field = screen.getByRole('textbox', { name: 'Topic name' })
    await userEvent.clear(field)
    await userEvent.type(field, '# Peek feedback  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onRename).toHaveBeenCalledWith('Peek feedback')
  })

  it('saves on Enter as well, because a field gets Enter pressed at it', async () => {
    const onRename = vi.fn().mockResolvedValue(null)
    await open({ onRename })

    const field = screen.getByRole('textbox', { name: 'Topic name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Peek feedback{Enter}')

    expect(onRename).toHaveBeenCalledWith('Peek feedback')
  })

  it('keeps what you typed and says why when the relay refuses', async () => {
    const onRename = vi.fn().mockResolvedValue('Only a channel owner or admin can rename it.')
    await open({ onRename })

    const field = screen.getByRole('textbox', { name: 'Topic name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Peek feedback')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Only a channel owner or admin can rename it.')).toBeInTheDocument()
    // Still editing, still holding the rejected text: throwing it away to show
    // the name it was replacing helps nobody.
    expect(screen.getByRole('textbox', { name: 'Topic name' })).toHaveValue('Peek feedback')
  })

  it('abandons the edit on Escape without renaming anything', async () => {
    const onRename = vi.fn()
    await open({ onRename })

    const field = screen.getByRole('textbox', { name: 'Topic name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Something else{Escape}')

    expect(onRename).not.toHaveBeenCalled()
    expect(screen.getByText('Feedback on Peek')).toBeInTheDocument()
  })

  it('leaves out the project section entirely when a topic has none', () => {
    render(<TopicDetailsDialogView details={details} folderProject={null} onClose={vi.fn()} />)

    // Absent rather than an empty heading — a section that says nothing is
    // still a section to read past.
    expect(screen.queryByText('Project')).not.toBeInTheDocument()
  })
})
