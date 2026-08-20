import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FolderProject, ForeignObject } from '../../convex/nostr/projection'
import { TopicProjectPanelView } from './TopicProjectPanel'

/**
 * PEEK-24's acceptance criteria, as assertions: a project widget headed Files,
 * its properties as controls, and every ticket it holds as a table inside it —
 * quiet by default, with a clean empty state rather than a broken widget.
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
  /*
   * `current` is who holds the field now — `buildObject` fills it from the fold
   * or the root event's tag. Without it this fixture was a project with no lead
   * at all, which is why nothing here noticed the control was showing a key.
   */
  { id: 'assign-project', label: 'Assign', control: 'pubkey', field: 'lead', current: 'b'.repeat(64) },
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
      // Who the lead is, resolved with the object (FEE-1).
      people: { ['b'.repeat(64)]: { displayName: 'Jan Miky' } },
      actions: projectActions,
      openUrl: 'http://localhost:5190/linear-lite/#/o/naddr1project',
      viaRecommendation: true,
    },
    tickets: [ticket('i1', 'Billing entry'), ticket('i2', 'Old thing', 'Done')],
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

    // Peek's `Select`, not a native one: the options exist only once the menu is
    // open, and are picked by their label rather than their value.
    await userEvent.click(screen.getByLabelText('Change status'))
    await userEvent.click(await screen.findByRole('option', { name: 'Planned' }))
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
    // A person, whether or not this viewer may reassign them.
    expect(screen.getByText('Jan Miky')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('bbbbbbbb')
  })

  it('names the lead on the control that reassigns them', async () => {
    render(<TopicProjectPanelView folderProject={folderProject()} onAct={vi.fn()} />)

    // The assign control both reports the lead and sets it, so this is the only
    // place the lead appears in the live panel — and it showed eight characters
    // of a key until FEE-1.
    const assign = await screen.findByRole('button', { name: 'Assign to me' })
    expect(assign).toHaveTextContent('Jan Miky')
    expect(document.body.textContent).not.toContain('bbbbbbbb')
  })

  it('counts finished against the total, and keeps the table shut until asked', () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    // 2 done of 3 counted. Read as a fraction, which is how anyone reads it.
    expect(screen.getByText('Tickets (2/3)')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  /**
   * The three readings that have to hold, because the previous format failed
   * all of them: it showed open/done, so "0/2" meant everything was finished
   * and "3/1" meant nothing much was.
   */
  it.each([
    { openCount: 3, doneCount: 0, label: 'Tickets (0/3)', reading: 'nothing done' },
    { openCount: 2, doneCount: 1, label: 'Tickets (1/3)', reading: 'one of three done' },
    { openCount: 0, doneCount: 3, label: 'Tickets (3/3)', reading: 'all done' },
  ])('reads $label as $reading', ({ openCount, doneCount, label }) => {
    render(<TopicProjectPanelView folderProject={folderProject({ openCount, doneCount })} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows progress through the work', () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    // 1 open, 2 done — two thirds of the way through.
    const bar = screen.getByRole('progressbar', { name: '2 of 3 tickets done' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '3')
    expect(bar.firstElementChild).toHaveStyle({ width: '67%' })
  })

  it('draws no progress bar for a project with no tickets at all', () => {
    render(
      <TopicProjectPanelView
        folderProject={folderProject({ tickets: [], openCount: 0, doneCount: 0 })}
      />,
    )

    // Nothing filed yet is not "0% done" — it is nothing to report.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows the ticket key from meta, never the description', async () => {
    /*
     * Ship maps `subtitle` to the issue's *content*, so reading the key from
     * there filled the column with the opening words of every ticket's body —
     * in production only, because the fixtures had been written to the same
     * wrong guess (2026-08-20).
     */
    const keyed = ticket('i9', 'Billing entry')
    keyed.slots.subtitle = { value: 'When I open the panel the assignee is missing…' }
    keyed.meta = [
      { value: 'FEE-9', field: 'ref' },
      { label: 'Assignee', value: 'c'.repeat(64), isPubkey: true, field: 'assignee' },
    ]
    render(<TopicProjectPanelView folderProject={folderProject({ tickets: [keyed] })} />)

    await userEvent.click(screen.getByRole('button', { name: /Tickets/ }))

    expect(screen.getByText('FEE-9')).toBeInTheDocument()
    expect(screen.queryByText(/When I open the panel/)).not.toBeInTheDocument()
    // A labelled meta entry is a property, not an identifier.
    expect(screen.queryByText(`${'c'.repeat(8)}…`)).not.toBeInTheDocument()
  })

  it('expands into a table of one row per ticket: title and status', async () => {
    render(<TopicProjectPanelView folderProject={folderProject()} />)

    await userEvent.click(screen.getByRole('button', { name: /Tickets/ }))

    const [first, second] = within(screen.getByRole('table')).getAllByRole('row')
    expect(within(first).getByRole('link', { name: 'Billing entry' })).toHaveAttribute(
      'href',
      'http://localhost:5190/linear-lite/#/o/naddr1i1',
    )
    expect(within(first).getByText('In Progress')).toBeInTheDocument()
    // Finished work is listed too, and says so.
    expect(within(second).getByText('Done')).toBeInTheDocument()
  })

  it('lists every ticket in the project, finished ones included', async () => {
    const many = Array.from({ length: 11 }, (_, i) => ticket(`i${i}`, `Live work ${i}`))
    render(
      <TopicProjectPanelView folderProject={folderProject({ tickets: many, openCount: 11 })} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Tickets (2/13)' }))

    expect(screen.getAllByRole('link', { name: /^Live work \d+$/ })).toHaveLength(11)
  })

  it('says so when the project holds no tickets at all', async () => {
    render(
      <TopicProjectPanelView
        folderProject={folderProject({ tickets: [], openCount: 0, doneCount: 0 })}
      />,
    )

    // Not "Tickets (0/0)" — a fraction of nothing reads as a broken counter.
    await userEvent.click(screen.getByRole('button', { name: 'Tickets' }))

    expect(screen.getByText('No tickets in this project yet.')).toBeInTheDocument()
  })

  it('renders a clean empty state for a topic with no linked project', () => {
    render(<TopicProjectPanelView folderProject={null} />)

    expect(screen.getByText('No project linked to this topic.')).toBeInTheDocument()
    expect(screen.queryByText(/Tickets/)).not.toBeInTheDocument()
  })
})
