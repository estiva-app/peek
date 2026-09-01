/**
 * PRO-4's first done-when clause: **Peek renders `add-issue` as a form.**
 *
 * Deliberately driven from the shape the *runtime* returns for Ship's live
 * manifest, not from `launcherActions.ts`'s registry — the registry is a
 * design proposal, and a test against it would prove the mock renders.
 *
 * The registry's own header is the bar: *"swapping this constant for a live
 * read must not reshape any UI."* So this renders the same `ActionFormPanel`,
 * unmodified, from a converted live action.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LAUNCHER_APPS } from '@/lib/launcherActions'
import { PARENT_FIELD, launcherActionFrom, splitSubmission } from '@/lib/liveAction'
import { ActionFormPanel } from './ActionFormPanel'

/** What `resolveForeignObject` returns for Ship's published `add-issue`. */
const liveAddIssue: ResolvedAction = {
  id: 'add-issue',
  label: 'Add issue',
  description: 'File a new issue under a project.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'title', type: 'string', required: true }],
  createsUnder: 'self',
}

const ship = LAUNCHER_APPS.find((a) => a.id === 'ship')!
const PROJECT = '30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:83902fcc'

function renderLive(onSubmit = vi.fn()) {
  const action = launcherActionFrom(liveAddIssue, { parentNoun: 'project', submitLabel: 'Create issue' })!
  render(
    <DebugProvider>
      <PeekDataProvider>
        <ActionFormPanel
        app={ship}
        action={action}
        parentOptions={{ [PARENT_FIELD]: [{ value: PROJECT, label: 'Projection layer' }] }}
          onSubmit={onSubmit}
        />
      </PeekDataProvider>
    </DebugProvider>,
  )
  return onSubmit
}

describe('Peek renders a live object-creating action as a form (PRO-4)', () => {
  it('draws the declared property and the parent picker', () => {
    renderLive()
    // Queried by role rather than by label: `@estiva-app/ui`'s `Field` renders
    // its label without a `for`/`id` association, so `getByLabelText` finds the
    // text and no control. Filed rather than worked around silently — it is a
    // real accessibility gap and it belongs in the shared package.
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    // The parent picker carries an aria-label, so it *is* reachable by name —
    // unlike the text input above, whose label `Field` never associates.
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
  })

  it('keeps submit disabled until every required field is filled', async () => {
    // The launcher's rule: only offer an action that can succeed. A form that
    // submitted an empty title would be refused by the runtime anyway — this
    // is Peek not asking the relay a question it already knows the answer to.
    renderLive()
    const submit = screen.getByRole('button', { name: /create issue/i })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByRole('textbox'), 'Billing entry')
    expect(submit).toBeDisabled() // the parent is required too, and unset
  })

  it('reports the title and the parent, separable for publishing', async () => {
    const onSubmit = renderLive()
    await userEvent.type(screen.getByRole('textbox'), 'Billing entry')
    // The shared Select is a button and a portalled menu, not a native <select>.
    await userEvent.click(screen.getByLabelText('Project'))
    await userEvent.click(await screen.findByText('Projection layer'))

    const submit = screen.getByRole('button', { name: /create issue/i })
    expect(submit).toBeEnabled()
    await userEvent.click(submit)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const values = onSubmit.mock.calls[0][0] as Record<string, string>

    // What the launcher hands the runtime: the parent split back out, because
    // the runtime refuses any key the manifest did not declare.
    const { parent, properties } = splitSubmission(values)
    expect(parent).toBe(PROJECT)
    expect(properties).toEqual({ title: 'Billing entry' })
  })
})
