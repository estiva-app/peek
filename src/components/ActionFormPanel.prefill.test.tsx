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
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LauncherAction, LauncherApp } from '@/lib/launcherActions'
import { ActionFormPanel } from './ActionFormPanel'

const action: LauncherAction = {
  id: 'add-issue',
  label: 'Add issue',
  submitLabel: 'Add issue',
  fields: [
    { key: 'title', label: 'Title', control: 'string', required: true, placeholder: 'Title…' },
    { key: 'description', label: 'Description', control: 'text', placeholder: 'Description…' },
  ],
}

/** No scope, the PEE-3 shape — prefill does not need one. */
const app = undefined as unknown as LauncherApp

function draw(prefill?: Record<string, string>) {
  const onSubmit = vi.fn()
  const view = render(<ActionFormPanel app={app} action={action} prefill={prefill} onSubmit={onSubmit} />)
  return { onSubmit, view }
}

/*
  By placeholder, not by label. `getByLabelText` does not work here because
  `TextInput` and `Textarea` never associate their label with the control —
  which is **SHA-17**, filed and open. Worth noting that a test reaching for the
  obvious query is what runs into it: the same gap a screen reader hits.
*/
const titleBox = () => screen.getByPlaceholderText('Title…')
const descBox = () => screen.getByPlaceholderText('Description…')

describe('prefill lands in the form (PEE-5)', () => {
  it('fills a field that arrives after the form opened', () => {
    const { view } = draw()
    expect(titleBox()).toHaveValue('')

    // The model answering a beat later, which is the normal case.
    view.rerender(
      <ActionFormPanel app={app} action={action} prefill={{ title: 'Build is broken' }} onSubmit={vi.fn()} />,
    )
    expect(titleBox()).toHaveValue('Build is broken')
  })

  it('leaves every field editable afterwards', async () => {
    // PEE-5: "every field is editable". A suggestion is a starting point, not
    // a value somebody has to work around.
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

    view.rerender(
      <ActionFormPanel
        app={app}
        action={action}
        prefill={{ title: 'The model’s title', description: 'The model’s description' }}
        onSubmit={vi.fn()}
      />,
    )
    expect(titleBox()).toHaveValue('My own title')
  })

  it('still fills the fields they did not touch', async () => {
    /*
      The half a whole-form rule throws away. Typing a title while the model is
      thinking should keep the title AND get the description — first-write-wins
      on the form would discard the description, last-write-wins would clobber
      the title.
    */
    const { view } = draw()
    await userEvent.type(titleBox(), 'My own title')

    view.rerender(
      <ActionFormPanel
        app={app}
        action={action}
        prefill={{ title: 'The model’s title', description: 'From the conversation' }}
        onSubmit={vi.fn()}
      />,
    )
    expect(titleBox()).toHaveValue('My own title')
    expect(descBox()).toHaveValue('From the conversation')
  })

  it('treats a field cleared back to empty as touched', async () => {
    // Deleting a suggestion is a decision about it. Refilling the box somebody
    // just emptied would be the most annoying possible reading of "untouched".
    const { view } = draw({ title: 'Build is broken' })
    await userEvent.clear(titleBox())

    view.rerender(
      <ActionFormPanel app={app} action={action} prefill={{ title: 'Build is broken' }} onSubmit={vi.fn()} />,
    )
    expect(titleBox()).toHaveValue('')
  })

  it('submits the suggestion only through a person', async () => {
    // PEE-5: "nothing submits without a person". A wrong issue filed silently
    // is worse than no issue, and the person is right there.
    const { onSubmit } = draw({ title: 'Build is broken' })
    expect(onSubmit).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Add issue' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'Build is broken' }))
  })
})

describe('nothing looks broken without a model (PEE-6)', () => {
  it('draws the ordinary form when no prefill ever arrives', async () => {
    /*
      The case for a phone, Safari, Firefox, and any desktop that has not
      downloaded the model — which is most people. There is no sparkle to grey
      out and no notice to read: an empty form is the normal case, not a
      degraded one.
    */
    draw(undefined)
    expect(titleBox()).toHaveValue('')
    expect(screen.queryByText(/unavailable/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ai/i)).not.toBeInTheDocument()

    await userEvent.type(titleBox(), 'Typed by hand')
    expect(titleBox()).toHaveValue('Typed by hand')
  })
})
