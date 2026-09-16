/**
 * PEE-6 — the typing race, and the promise that nothing looks broken.
 *
 * > *"Prefill arriving after the person has started typing … Overwriting what
 * > somebody typed is unacceptable; discarding a useful suggestion silently is
 * > a waste. This needs a designed answer rather than whichever the
 * > implementation makes easy."*
 *
 * The designed answer is **per field**: a suggestion lands in every box the
 * person has not touched, and never in one they have. These tests are that
 * decision written down, because it is the kind of behaviour a later
 * refactor would flatten to whole-form first-write-wins without noticing it
 * had thrown away the other half.
 *
 * Since UIG-29 the draft is the launcher's, so it survives going back and
 * coming in again, and the suggestion is applied by `applyPrefill`. The harness
 * below holds the draft the way the launcher does.
 */
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LauncherAction } from '@/lib/launcherActions'
import { ActionFormFields } from './ActionFormPanel'
import { applyPrefill, draftValues, seedDraft } from '@/lib/formDraft'

const action: LauncherAction = {
  id: 'add-issue',
  label: 'Add issue',
  submitLabel: 'Add issue',
  fields: [
    { key: 'title', label: 'Title', control: 'string', required: true, placeholder: 'Title…' },
    { key: 'description', label: 'Description', control: 'text', placeholder: 'Description…' },
  ],
}

function Form({ prefill, onSubmit }: { prefill?: Record<string, string>; onSubmit: (values: Record<string, string>) => void }) {
  const [draft, setDraft] = useState(() => seedDraft(action))
  // A suggestion arriving is applied once, when it arrives — adjusted during
  // render rather than in an effect, as the launcher applies it on the answer.
  const [applied, setApplied] = useState<Record<string, string> | undefined>(undefined)
  if (prefill !== applied) {
    setApplied(prefill)
    if (prefill) setDraft((d) => applyPrefill(d, prefill))
  }
  return (
    <>
      <ActionFormFields action={action} draft={draft} onDraft={setDraft} />
      <button type="button" onClick={() => onSubmit(draftValues(action, draft))}>
        Add issue
      </button>
    </>
  )
}

function draw(prefill?: Record<string, string>) {
  const onSubmit = vi.fn()
  const view = render(<Form prefill={prefill} onSubmit={onSubmit} />)
  return { onSubmit, view }
}

/*
  By label, which is the query a person's screen reader makes too. Anchored
  rather than exact, because the required marker's asterisk is drawn beside the
  label and hidden from the name — which is what a screen reader announces.
*/
const titleBox = () => screen.getByLabelText(/^Title/)
const descBox = () => screen.getByLabelText(/^Description/)

describe('prefill lands in the form (PEE-5)', () => {
  it('fills a field that arrives after the form opened', () => {
    const { view } = draw()
    expect(titleBox()).toHaveValue('')
    // The model answering a beat later, which is the normal case.
    view.rerender(<Form prefill={{ title: 'Build is broken' }} onSubmit={vi.fn()} />)
    expect(titleBox()).toHaveValue('Build is broken')
  })

  it('leaves every field editable afterwards', async () => {
    // PEE-5: "every field is editable". A suggestion is a starting point.
    draw({ title: 'Build is broken' })
    await userEvent.clear(titleBox())
    await userEvent.type(titleBox(), 'Something else')
    expect(titleBox()).toHaveValue('Something else')
  })
})

describe('the typing race has a designed answer (PEE-6)', () => {
  it('never overwrites what the person typed', async () => {
    const { view } = draw()
    await userEvent.type(titleBox(), 'My own title')
    view.rerender(<Form prefill={{ title: 'The model’s title', description: 'The model’s description' }} onSubmit={vi.fn()} />)
    expect(titleBox()).toHaveValue('My own title')
  })

  it('still fills the fields they did not touch', async () => {
    // The half a whole-form rule throws away: keep the title AND get the description.
    const { view } = draw()
    await userEvent.type(titleBox(), 'My own title')
    view.rerender(<Form prefill={{ title: 'The model’s title', description: 'From the conversation' }} onSubmit={vi.fn()} />)
    expect(titleBox()).toHaveValue('My own title')
    expect(descBox()).toHaveValue('From the conversation')
  })

  it('treats a field cleared back to empty as touched', async () => {
    // Deleting a suggestion is a decision about it.
    const { view } = draw({ title: 'Build is broken' })
    await userEvent.clear(titleBox())
    view.rerender(<Form prefill={{ title: 'Build is broken!' }} onSubmit={vi.fn()} />)
    expect(titleBox()).toHaveValue('')
  })

  it('submits the suggestion only through a person', async () => {
    // PEE-5: "nothing submits without a person".
    const { onSubmit } = draw({ title: 'Build is broken' })
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Add issue' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Build is broken' }))
  })
})

describe('nothing looks broken without a model (PEE-6)', () => {
  it('draws the ordinary form when no prefill ever arrives', async () => {
    draw(undefined)
    expect(titleBox()).toHaveValue('')
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument()
    await userEvent.type(titleBox(), 'Typed by hand')
    expect(titleBox()).toHaveValue('Typed by hand')
  })
})
