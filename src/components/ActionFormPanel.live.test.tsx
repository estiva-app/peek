/**
 * PRO-4's first done-when clause: **Peek renders `add-issue` as a form.**
 *
 * Deliberately driven from the shape the *runtime* returns for Ship's live
 * manifest, not from `launcherActions.ts`'s registry — the registry is a
 * design proposal, and a test against it would prove the mock renders.
 *
 * The registry's own header is the bar: *"swapping this constant for a live
 * read must not reshape any UI."* So this renders the same `ActionFormFields`
 * the launcher draws, from a converted live action. The frame around them —
 * the button, Ctrl+Enter, the lock while creating — is the package's
 * `CommandPaletteForm` since UIG-29, and pinned there; this stands in a plain
 * submit for it.
 */
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LAUNCHER_APPS, type LauncherAction } from '@/lib/launcherActions'
import { PARENT_FIELD, launcherActionFrom, splitSubmission } from '@/lib/liveAction'
import { ActionFormFields } from './ActionFormPanel'
import { draftValues, missingFields, seedDraft } from '@/lib/formDraft'

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

function LiveForm({ action, onSubmit }: { action: LauncherAction; onSubmit: (values: Record<string, string>) => void }) {
  const [draft, setDraft] = useState(() => seedDraft(action))
  const [missing, setMissing] = useState<Record<string, string>>()
  return (
    <>
      <ActionFormFields
        app={ship}
        action={action}
        parentOptions={{ [PARENT_FIELD]: [{ value: PROJECT, label: 'Projection layer' }] }}
        draft={draft}
        onDraft={setDraft}
        missing={missing}
      />
      <button
        type="button"
        onClick={() => {
          const need = missingFields(action, draft)
          setMissing(need)
          if (Object.keys(need).length === 0) onSubmit(draftValues(action, draft))
        }}
      >
        Submit
      </button>
    </>
  )
}

function renderLive(onSubmit = vi.fn()) {
  const action = launcherActionFrom(liveAddIssue, { parentNoun: 'project', submitLabel: 'Create issue' })!
  render(
    <DebugProvider>
      <PeekDataProvider>
        <LiveForm action={action} onSubmit={onSubmit} />
      </PeekDataProvider>
    </DebugProvider>,
  )
  return onSubmit
}

describe('Peek renders a live object-creating action as a form (PRO-4)', () => {
  it('draws the declared property and the parent picker', () => {
    renderLive()
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument()
    // The app's own word for the parent, not "Parent" (R10).
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
  })

  it('says what each missing field needs instead of submitting', async () => {
    // R14: a submit that silently does nothing gave no reason. Each missing
    // field says what it needs, and nothing is sent.
    const onSubmit = renderLive()
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Give it a title.')).toBeInTheDocument()
    expect(screen.getByText('Choose a project.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/^Title/), 'Billing entry')
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))
    expect(onSubmit).not.toHaveBeenCalled() // the parent is required too, and unset
    expect(screen.queryByText('Give it a title.')).not.toBeInTheDocument()
  })

  it('reports the title and the parent, separable for publishing', async () => {
    const onSubmit = renderLive()
    await userEvent.type(screen.getByLabelText(/^Title/), 'Billing entry')
    // The shared Select is a button and a portalled menu, not a native <select>.
    await userEvent.click(screen.getByLabelText('Project'))
    await userEvent.click(await screen.findByRole('option', { name: 'Projection layer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const values = onSubmit.mock.calls[0][0] as Record<string, string>
    // What the launcher hands the runtime: the parent split back out, because
    // the runtime refuses any key the manifest did not declare.
    const { parent, properties } = splitSubmission(values)
    expect(parent).toBe(PROJECT)
    expect(properties).toEqual({ title: 'Billing entry' })
  })
})
