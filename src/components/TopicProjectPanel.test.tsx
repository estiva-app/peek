import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FolderProject, ForeignObject } from '../../convex/nostr/projection'
import { TopicProjectPanelView } from './TopicProjectPanel'

/**
 * PEEK-24's acceptance criteria, as assertions: a project widget headed Files,
 * its properties as controls, and its tickets as a table inside it — quiet by
 * default, capped at seven, with a clean empty state rather than a broken
 * widget.
 *
 * Which tickets count as open is decided in `projection.ts` and tested there.
 * The panel draws what it is handed, and keeping that split is what stops the
 * status rule from being reimplemented in the component.
 */
const projectActions: ForeignObject['actions'] = [
  {
    id: 'set-project-status',
    label: 'Change status',
    control: 'select',
    field: 'status',
    current: 'in_progress',
    options: [
      { value: 'planned', label: 'Planned' },
      { value: 'in_progress', label: 'In Progress' },
    ],
  },
  { id: 'assign-project', label: 'Assign', control: 'pubkey', field: 'lead' },
  // Declared for this kind, but a comment box would compete with the
  // conversation alongside; the panel does not draw it.
  { id: 'comment', label: 'Comment', control: 'text' },
]

const ticket = (id: string, title: string, status = 'In Progress'): ForeignObject => ({
  address: `30851:abc:${id}`,
  naddr: `naddr1${id}`,
  kind: 30851,
  widget: 'row',
  appName: 'Linear-lite',
  slots: { title: { value: title }, status: { value: status, colour: 'blue', field: 'status' } },
  meta: [],
  comments: [],
  actions: [],
  openUrl: `http://localhost:5190/linear-lite/#/o/naddr1${id}`,
  viaRecommendation: true,
})

function folderProject(overrides: Partial<FolderProject> = {}): FolderProject {
  return {
    project: {
      address: '30850:abc:p1',
      naddr: 'naddr1project',
      kind: 30850,
      widget: 'card',
      appName: 'Linear-lite',
      slots: {
        title: { value: 'Payment integration' },
        subtitle: { value: 'Stripe Checkout for workspace billing.' },
        status: { value: 'In Progress', colour: 'blue', field: 'status' },
      },
      meta: [{ label: 'Lead', value: 'b'.repeat(64), isPubkey: true, field: 'lead' }],
      comments: [],
      actions: projectActions,
      openUrl: 'http://localhost:5190/linear-lite/#/o/naddr1project',
      viaRecommendation: true,
    },
    tickets: [ticket('i1', 'Billing entry')],
    moreTickets: 0,
    openCount: 1,
    doneCount: 2,
    ...overrides,
  }
}

describe('TopicProjectPanelView', () => {
  it('is headed Files, not Project', () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    expect(screen.getByText('Files')).toBeInTheDocument()
    expect(screen.queryByText('Project')).not.toBeInTheDocument()
  })

  it('leads with the title, linked into the owning app and nothing else', () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    const link = screen.getByRole('link', { name: 'Payment integration' })
    expect(link).toHaveAttribute('href', 'http://localhost:5190/linear-lite/#/o/naddr1project')
    // The title *is* the way out; a second "Open in Linear-lite" is the same
    // destination twice.
    expect(screen.queryByText(/Open in/)).not.toBeInTheDocument()
    expect(screen.getByText('Stripe Checkout for workspace billing.')).toBeInTheDocument()
  })

  it('renders status and assignee as controls that change them', async () => {
    const onAct = vi.fn()
    render(<TopicProjectPanelView folderProject={folderProject()} onAct={onAct} />)

    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Lead')).toBeInTheDocument()
    // The comment action is declared but never drawn.
    expect(screen.queryByPlaceholderText('Comment…')).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Change status'), 'planned')
    expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ naddr: 'naddr1project' }),
      'set-project-status',
      'planned',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Assign to me' }))
    expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ naddr: 'naddr1project' }),
      'assign-project',
      '@me',
    )
  })

  it('shows properties as plain values when the app declares no actions', () => {
    const bare = folderProject()
    bare.project = { ...bare.project, actions: [] }
    render(<TopicProjectPanelView folderProject={bare} onAct={vi.fn()} />)

    // Never a dead control: the owning app has not said these may be set here.
    expect(screen.queryByLabelText('Change status')).not.toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText(`${'b'.repeat(8)}…`)).toBeInTheDocument()
  })

  it('counts open against done, and keeps the table shut until asked', () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    expect(screen.getByText('Tickets (1/2)')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('expands into a table of one row per ticket: title and status', async () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    await userEvent.click(screen.getByRole('button', { name: /Tickets/ }))

    const row = within(screen.getByRole('table')).getByRole('row')
    expect(within(row).getByRole('link', { name: 'Billing entry' })).toHaveAttribute(
      'href',
      'http://localhost:5190/linear-lite/#/o/naddr1i1',
    )
    expect(within(row).getByText('In Progress')).toBeInTheDocument()
  })

  it('shows at most seven rows and says how many are left', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ticket(`i${i}`, `Live work ${i}`))
    render(
      <TopicProjectPanelView
        folderProject={folderProject({ tickets: many, moreTickets: 4, openCount: 11 })}
      />,
    )

    // The count is the true total, not the number of rows.
    await userEvent.click(screen.getByRole('button', { name: 'Tickets (11/2)' }))

    expect(screen.getAllByRole('link', { name: /^Live work \d$/ })).toHaveLength(7)
    expect(screen.getByText('+4 more open')).toBeInTheDocument()
  })

  it('says so when nothing is open', async () => {
    render(
      <TopicProjectPanelView folderProject={folderProject({ tickets: [], openCount: 0 })} />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Tickets/ }))

    expect(screen.getByText('Nothing open right now.')).toBeInTheDocument()
  })

  it('renders a clean empty state for a topic with no linked project', () => {
    render(<TopicProjectPanelView folderProject={null} />)

    expect(screen.getByText('No project linked to this topic.')).toBeInTheDocument()
    expect(screen.queryByText(/Tickets/)).not.toBeInTheDocument()
  })
})
