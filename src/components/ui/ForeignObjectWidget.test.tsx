import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ForeignObject } from '@estiva-app/interop'
import { markerTextToBlockDocument, parseBlockDocument, serializeBlockDocument } from '@estiva-app/protocol'

/**
 * The widget renders whatever the manifest said, and nothing else.
 *
 * These tests deliberately never mention Linear-lite's kind numbers or field
 * names — they hand the component a manifest-shaped payload and assert it is
 * drawn faithfully. If the component ever starts special-casing a particular
 * app, a test written this way keeps passing while the claim quietly dies, so
 * the last test here asserts the negative directly: an app Peek has never heard
 * of renders exactly as well.
 */
const resolveObject = vi.fn()

const applyAction = vi.fn()
// Both come from the seam now rather than from Convex actions (PEEK-106): the
// relay read and the publish happen in the browser, so there is no action to
// mock and `@/api` is the only seam to stub.
vi.mock('@/api', async () => {
  const { useCallback, useEffect, useState } = await import('react')
  return {
  hasRelay: true,
  useForeignObjects: () => ({ resolveObject, applyAction, resolveFolderProject: vi.fn() }),
  // The tab's held answer (OPT-3), reduced to a resolve on mount and on `reload`.
  useHeldObject: (reference: string | null) => {
    const [object, setObject] = useState<unknown>(reference ? 'loading' : null)
    const reload = useCallback(
      () => (reference ? resolveObject(reference).then(setObject, () => setObject(null)) : Promise.resolve()),
      [reference],
    )
    useEffect(() => void reload(), [reload])
    return { object, reload }
  },
  // The assignee picker's option list (PEE-1) — two known people.
  useWorkspaceDirectory: () => ({
    ['a'.repeat(64)]: { displayName: 'Alice Chen' },
    ['b'.repeat(64)]: { displayName: 'Bruno Ferreira' },
  }),
  // `Avatar` resolves portraits through the seam, and a person now has a face.
  useAvatarSrc: () => () => undefined,
  }
})

const { ForeignObjectWidget } = await import('./ForeignObjectWidget')

const NADDR = 'naddr1qqjrje33vg6xzvnr95mk2vmy95'

function object(overrides: Partial<ForeignObject> = {}): ForeignObject {
  return {
    ref: '30851:abc:issue-1',
    address: '30851:abc:issue-1',
    eventId: 'e'.repeat(64),
    naddr: NADDR,
    kind: 30851,
    widget: 'row',
    appName: 'Linear-lite',
    slots: {
      title: { value: 'Billing entry + add payment method', field: 'title' },
      status: { value: 'Done', colour: 'green', field: 'status' },
    },
    meta: [
      { value: 'PAY-1', field: 'ref' },
      { label: 'Assignee', value: 'a'.repeat(64), isPubkey: true, field: 'assignee' },
    ],
    comments: [{ id: 'c1', author: 'b'.repeat(64), body: 'Blocked on the Stripe key.', createdAt: 1 }],
    people: { ['a'.repeat(64)]: { displayName: 'Alice Chen' } },
    actions: [],
    viaRecommendation: true,
    ...overrides,
  }
}

beforeEach(() => {
  resolveObject.mockReset()
  applyAction.mockReset()
})

describe('ForeignObjectWidget', () => {
  it('renders the declared slots', async () => {
    resolveObject.mockResolvedValue(object())
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByText('Billing entry + add payment method')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('PAY-1')).toBeInTheDocument()
  })

  it('shows a pubkey as a person, never as any part of the key', async () => {
    resolveObject.mockResolvedValue(object())
    render(<ForeignObjectWidget naddr={NADDR} />)

    await screen.findByText('Billing entry + add payment method')
    expect(screen.getByText('Alice Chen')).toBeInTheDocument()
    // Not the whole key, and not the first eight characters of it either — an
    // abbreviated key is still a key, and it was what FEE-1 was about.
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('aaaaaaaa')
    // And no caption in front of them: a face beside a name needs no label
    // saying it is a person (Katerina, 2026-08-19).
    expect(screen.queryByText(/Assignee:/)).not.toBeInTheDocument()
  })

  it('says a person is there but unnamed rather than falling back to the key', async () => {
    // Nobody has published a kind:0 for them — rare, since Estiva ID writes one
    // at signup, but the key must not come back when it happens.
    resolveObject.mockResolvedValue(object({ people: {} }))
    render(<ForeignObjectWidget naddr={NADDR} />)

    await screen.findByText('Billing entry + add payment method')
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('aaaaaaaa')
  })

  it('labels the object by what it is, not by the app it is in', async () => {
    // PRO-24: "Issue", not "Estiva Ship". An app name is only where a link goes.
    resolveObject.mockResolvedValue(object({ noun: 'issue' }))
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByText('Issue')).toBeInTheDocument()
    expect(screen.queryByText('Linear-lite')).not.toBeInTheDocument()
  })

  it('falls back to the app name only when the app declares no noun, even when the handler was a guess', async () => {
    /*
     * There used to be a `?` here when no NIP-89 recommendation named the
     * handler. It was true and unreadable — "ESTIVA SHIP ?" reads as a broken
     * widget to anyone who does not know what a handler recommendation is
     * (Katerina, 2026-08-19).
     */
    resolveObject.mockResolvedValue(object({ viaRecommendation: false }))
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByText('Linear-lite')).toBeInTheDocument()
    expect(screen.queryByText(/\?/)).not.toBeInTheDocument()
  })

  it('never labels Peek’s own object "Peek"', async () => {
    resolveObject.mockResolvedValue(object({ appName: 'Peek' }))
    render(<ForeignObjectWidget naddr={NADDR} />)

    await screen.findByText('Billing entry + add payment method')
    expect(screen.queryByText('Peek')).not.toBeInTheDocument()
    // Nor "File": with no noun there is nothing true to say, so it says nothing.
    expect(screen.queryByText('File')).not.toBeInTheDocument()
  })

  it('leaves the label to the panel on the object’s own page', async () => {
    resolveObject.mockResolvedValue(object({ noun: 'issue' }))
    render(<ForeignObjectWidget naddr={NADDR} page />)

    await screen.findByText('Billing entry + add payment method')
    expect(screen.queryByText('Issue')).not.toBeInTheDocument()
  })

  it('does not restate comments the conversation around it already shows', async () => {
    // PEEK-18. For Linear-lite a comment *is* a topic message, so the widget was
    // re-rendering the thread it sits inside. You reply to the message instead.
    resolveObject.mockResolvedValue(object())
    render(<ForeignObjectWidget naddr={NADDR} />)

    await screen.findByText('Billing entry + add payment method')
    expect(screen.queryByText('Blocked on the Stripe key.')).not.toBeInTheDocument()
  })

  it('leaves opening the app to the title, not a second link beside it', async () => {
    resolveObject.mockResolvedValue(object({ openUrl: 'http://localhost:5190/#/o/naddr1x' }))
    render(<ForeignObjectWidget naddr={NADDR} />)

    const links = await screen.findAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveTextContent('Billing entry + add payment method')
    expect(links[0]).toHaveAttribute('href', 'http://localhost:5190/#/o/naddr1x')
  })

  it('still offers the link when there is no title to click', async () => {
    // The unreachable card never resolved a title, so removing its link would
    // leave no way to reach the object at all — exactly when you want one.
    resolveObject.mockResolvedValue(
      object({ unreachable: true, openUrl: 'http://localhost:5190/#/o/naddr1x' }),
    )
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByRole('link', { name: /Open in Linear-lite/ })).toBeInTheDocument()
  })

  it('says so when the object is unreachable rather than rendering nothing', async () => {
    resolveObject.mockResolvedValue(object({ unreachable: true }))
    render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText(/may not have access/)).toBeInTheDocument()
  })

  it('names an unreachable object by its type when the app declares one', async () => {
    resolveObject.mockResolvedValue(object({ unreachable: true, noun: 'issue' }))
    render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText(/^Issue — you may not have access/)).toBeInTheDocument()
  })

  it('degrades to nothing when the reference cannot be resolved', async () => {
    resolveObject.mockResolvedValue(null)
    const { container } = render(<ForeignObjectWidget naddr={NADDR} />)
    await waitFor(() => expect(resolveObject).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an app it has never heard of just as well', async () => {
    // No Linear-lite kinds, no Linear-lite vocabulary. If the component had any
    // knowledge of a specific app baked in, this is what would expose it.
    resolveObject.mockResolvedValue(
      object({
        kind: 31337,
        widget: 'card',
        appName: 'Invoices-lite',
        slots: {
          title: { value: 'INV-2201' },
          subtitle: { value: 'Acme Ltd — 90 days overdue' },
          status: { value: 'Overdue', colour: 'blue' },
        },
        meta: [{ label: 'Amount', value: '£4,200' }],
        comments: [],
      }),
    )
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByText('INV-2201')).toBeInTheDocument()
    expect(screen.getByText('Overdue')).toBeInTheDocument()
    // `subtitle` is a card-only slot, so this also pins widget-type behaviour.
    expect(screen.getByText('Acme Ltd — 90 days overdue')).toBeInTheDocument()
    expect(screen.getByText(/Amount:/)).toHaveTextContent('£4,200')
  })

  describe('actions', () => {
    const withActions = () =>
      object({
        actions: [
          {
            id: 'set-issue-status',
            label: 'Change status',
            control: 'select',
            field: 'status',
            current: 'todo',
            options: [
              { value: 'todo', label: 'Todo' },
              { value: 'done', label: 'Done', colour: 'green' },
            ],
          },
          { id: 'assign-issue', label: 'Assign', control: 'pubkey', field: 'assignee' },
        ],
      })

    it('shows a field once — in the control, not also as a label', async () => {
      // PEEK-18. The pill and the picker were the same status, and the pill is
      // the copy that goes stale. Matched on the field the manifest named, so
      // this holds for any app rather than for a slot Peek happens to call
      // "status".
      resolveObject.mockResolvedValue(withActions())
      render(<ForeignObjectWidget naddr={NADDR} />)

      const status = await screen.findByLabelText('Change status')
      // The pill is a span; "Done" survives inside the picker, which is the copy
      // that should remain. The picker draws its options only when open.
      expect(screen.queryByText('Done', { selector: 'span' })).not.toBeInTheDocument()
      await userEvent.click(status)
      expect(await screen.findByRole('option', { name: 'Done' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByText(/Assignee:/)).not.toBeInTheDocument()
      // A meta slot no action covers is untouched — this hides duplicates, not
      // the meta line.
      expect(screen.getByText('PAY-1')).toBeInTheDocument()
    })

    it('names the current assignee on the control that sets it', async () => {
      resolveObject.mockResolvedValue(
        object({
          actions: [
            {
              id: 'assign-issue',
              label: 'Assign',
              control: 'pubkey',
              field: 'assignee',
              current: 'a'.repeat(64),
            },
          ],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} />)

      // Reports and sets, in one control: the picker's trigger shows the
      // holder's name (PEE-1 replaced the "Assign to me" button with the
      // person list). The accessible name stays on what the control does.
      const trigger = await screen.findByRole('combobox', { name: 'Assign' })
      expect(trigger).toHaveTextContent('Alice Chen')
      // The person *is* the label. "Assign: Alice Chen" captioned a face with
      // the word for what a face is.
      expect(trigger).not.toHaveTextContent('Assign:')
    })

    it('offers the people list with Unassigned, and picking publishes the pubkey (PEE-1)', async () => {
      applyAction.mockResolvedValue({ ok: true })
      resolveObject.mockResolvedValue(
        object({
          actions: [
            {
              id: 'assign-issue',
              label: 'Assign',
              control: 'pubkey',
              field: 'assignee',
              current: 'a'.repeat(64),
            },
          ],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} />)

      await userEvent.click(await screen.findByRole('combobox', { name: 'Assign' }))
      // Ship's option shape: Unassigned first, then everyone with a face.
      const unassigned = await screen.findByRole('option', { name: /Unassigned/ })
      expect(screen.getByRole('option', { name: /Bruno Ferreira/ })).toBeInTheDocument()

      // Picking Unassigned publishes an EMPTY value — the clear the relay folds.
      await userEvent.click(unassigned)
      await waitFor(() =>
        expect(applyAction).toHaveBeenCalledWith({ naddr: NADDR, actionId: 'assign-issue', value: '' }),
      )
    })

    it('reads "Unassigned" when nobody holds the field — never "assign to me"', async () => {
      resolveObject.mockResolvedValue(
        object({
          actions: [
            { id: 'assign-issue', label: 'Assign', control: 'pubkey', field: 'assignee' },
          ],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} />)

      const trigger = await screen.findByRole('combobox', { name: 'Assign' })
      expect(trigger).toHaveTextContent('Unassigned')
      expect(trigger).not.toHaveTextContent(/to me/)
    })

    it('never draws a comment box — you reply to the message instead', async () => {
      resolveObject.mockResolvedValue(
        object({
          // No `field`: a comment emits a whole event rather than setting one
          // value, and that is how the declaration says so.
          actions: [{ id: 'comment', label: 'Comment', control: 'text' }],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} />)

      await screen.findByText('Billing entry + add payment method')
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('never draws a rename box either — the title is the heading, and the page renames (FOL-33)', async () => {
      resolveObject.mockResolvedValue(
        object({
          // What interop 0.25.0 resolves for a bare file: a text action on the
          // title's own field, and a deletion with no field at all.
          kind: 30840,
          actions: [
            { id: 'comment', label: 'Comment', control: 'text' },
            { id: 'rename', label: 'Rename', control: 'text', field: 'title' },
            { id: 'delete', label: 'Delete', control: 'confirm', effect: 'destructive' },
          ],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} />)

      await screen.findByText('Billing entry + add payment method')
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    })

    // A row: on a card the prose field is the body's own editor (MAN-9), tested below.
    it('draws no one-line box in the action row for a prose field, nor for a move (MAN-4)', async () => {
      resolveObject.mockResolvedValue(
        object({
          // What interop 0.36.0 resolves for Ship's describe-issue and
          // move-issue: a text change declaring a block document, and a text
          // change on the field its list declares as `movedBy`.
          parentField: 'project',
          actions: [
            { id: 'describe-issue', label: 'Edit description', control: 'text', field: 'description', format: 'estiva-blocks-1' },
            { id: 'move-issue', label: 'Move to project', control: 'text', field: 'project' },
            { id: 'set-issue-status', label: 'Change status', control: 'select', field: 'status', current: 'todo', options: [{ value: 'todo', label: 'Todo' }] },
          ],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} />)

      // The other controls still draw: this is a filter on two shapes, not on the row.
      expect(await screen.findByLabelText('Change status')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('keeps the labels on a card with no controls to defer to', async () => {
      // The topic sidebar renders read-only. With no picker on screen the status
      // pill is the only thing saying what the status is, so it stays.
      const { ForeignObjectCard } = await import('./ForeignObjectWidget')
      render(<ForeignObjectCard object={withActions()} />)

      expect(screen.getByText('Done')).toBeInTheDocument()
      // The status label stays — with no picker on screen, the pill is the only
      // thing saying what the status is. The assignee needs no such help.
      expect(screen.getByText('Alice Chen')).toBeInTheDocument()
    })

    it('draws a control per declared action, using the owner\'s vocabulary', async () => {
      resolveObject.mockResolvedValue(withActions())
      render(<ForeignObjectWidget naddr={NADDR} />)

      const status = await screen.findByLabelText('Change status')
      // The trigger reports the current value by its label, not its raw value.
      expect(status).toHaveTextContent('Todo')
      await userEvent.click(status)
      expect(await screen.findByRole('option', { name: 'Done' })).toBeInTheDocument()
      await userEvent.keyboard('{Escape}')
      // The pubkey action draws the person picker (PEE-1), not a self-assign button.
      expect(screen.getByRole('combobox', { name: 'Assign' })).toBeInTheDocument()
    })

    it('publishes the change and re-reads from the relay', async () => {
      resolveObject.mockResolvedValue(withActions())
      applyAction.mockResolvedValue({ ok: true })
      render(<ForeignObjectWidget naddr={NADDR} />)

      await userEvent.click(await screen.findByLabelText('Change status'))
      await userEvent.click(await screen.findByRole('option', { name: 'Done' }))

      expect(applyAction).toHaveBeenCalledWith({
        naddr: NADDR,
        actionId: 'set-issue-status',
        value: 'done',
      })
      // Re-read rather than patch: the relay is the authority on whether the
      // change happened, so the widget must never claim one it does not have.
      await waitFor(() => expect(resolveObject).toHaveBeenCalledTimes(2))
    })

    it("sends the picked person's pubkey — public identity, never key material", async () => {
      resolveObject.mockResolvedValue(withActions())
      applyAction.mockResolvedValue({ ok: true })
      render(<ForeignObjectWidget naddr={NADDR} />)

      // The picker replaced the "@me" button (PEE-1): anybody in the workspace
      // directory is one pick away, yourself included as an ordinary row.
      await userEvent.click(await screen.findByRole('combobox', { name: 'Assign' }))
      await userEvent.click(await screen.findByRole('option', { name: /Bruno Ferreira/ }))
      expect(applyAction).toHaveBeenCalledWith({
        naddr: NADDR,
        actionId: 'assign-issue',
        value: 'b'.repeat(64),
      })
    })

    it('surfaces a refusal instead of silently doing nothing', async () => {
      resolveObject.mockResolvedValue(withActions())
      applyAction.mockResolvedValue({ ok: false, reason: '"ushipped" is not one of todo, done.' })
      render(<ForeignObjectWidget naddr={NADDR} />)

      await userEvent.click(await screen.findByLabelText('Change status'))
      await userEvent.click(await screen.findByRole('option', { name: 'Done' }))
      expect(await screen.findByText(/is not one of todo, done/)).toBeInTheDocument()
      // One resolve only — a rejected change must not look like a successful one.
      expect(resolveObject).toHaveBeenCalledTimes(1)
    })

    it('offers no controls when the manifest declares none', async () => {
      resolveObject.mockResolvedValue(object({ actions: [] }))
      render(<ForeignObjectWidget naddr={NADDR} />)
      await screen.findByText('Billing entry + add payment method')
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    })
  })
})

/**
 * PRO-2's `body` slot at the widget boundary. `ForeignBody.test.tsx` covers how
 * a body is rendered; this covers *whether* — the same card/row rule the
 * subtitle follows, and that an app declaring no body still renders.
 */
describe('the body slot', () => {
  const body = { value: '# Goal\n\nStripe **Checkout**.', format: 'marker' as const }
  // The module is imported lazily above for the same reason: this file mocks
  // the resolver, and a top-level import would bind before the mock is set.

  it('draws a card’s body through the manifest', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const { container } = render(<ForeignObjectCard object={object({ widget: 'card', slots: { title: { value: 'Payments' }, body } })} />)
    expect(container.querySelector('[data-foreign-body] h1')?.textContent).toBe('Goal')
    expect(container.querySelector('[data-foreign-body] strong')?.textContent).toBe('Checkout')
  })

  it('leaves it off a row, which is a single line by definition', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const { container } = render(<ForeignObjectCard object={object({ widget: 'row', slots: { title: { value: 'Payments' }, body } })} />)
    expect(container.querySelector('[data-foreign-body]')).toBeNull()
  })

  it('renders the rest for an app that declares no body at all', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    // §7.2's obligation, from the other side: a consumer that has learned a new
    // slot must not start requiring it. Every manifest published before PRO-2
    // declares none.
    const { container } = render(<ForeignObjectCard object={object({ widget: 'card' })} />)
    expect(container.querySelector('[data-foreign-body]')).toBeNull()
    expect(container.textContent).toContain('Billing entry')
  })
})

/**
 * The body as its own editor, for an app that declares a block-document action
 * on it (MAN-9). What matters is what a save publishes: the document with the
 * ids it opened with, so a comment anchored to one of its blocks stays there
 * (SPEC §13.6), and the format it is written in.
 */
describe('a block-document body', () => {
  const stored = serializeBlockDocument(markerTextToBlockDocument('# Goal\n\nStripe **Checkout**.'))
  const ids = parseBlockDocument(stored).content.map((b) => b.id)
  const describeIssue = {
    id: 'describe-issue',
    label: 'Edit description',
    control: 'text',
    field: 'description',
    format: 'estiva-blocks-1',
  } as unknown as ForeignObject['actions'][number]
  const described = (overrides: Partial<ForeignObject> = {}) =>
    object({
      widget: 'card',
      slots: {
        title: { value: 'Payments', field: 'title' },
        body: { value: stored, format: 'blocks', field: 'description' },
      },
      actions: [describeIssue],
      ...overrides,
    })
  type Pm = { commands: { focus: (at?: string, options?: { scrollIntoView?: boolean }) => void; insertContent: (text: string) => void; blur: () => void } }
  // The textbox is the ProseMirror node, and Tiptap hangs the editor on it.
  const editorOf = (box: HTMLElement) => (box as unknown as { editor: Pm }).editor
  /*
    The textbox once its editor is live. The card arrives after the resolve,
    outside `act`, and Tiptap's first instance is replaced as it mounts — so
    the first node found can be the discarded one (an editor's view mounts
    after its first render, and until then Tiptap counts it destroyed).
  */
  const settled = async () => {
    await screen.findByRole('textbox', { name: 'Edit description' })
    await act(() => new Promise((r) => setTimeout(r, 10)))
    const box = screen.getByRole('textbox', { name: 'Edit description' })
    expect(editorOf(box)).toBeDefined()
    return box
  }

  it('opens the stored document, its ids on its blocks', async () => {
    resolveObject.mockResolvedValue(described())
    render(<ForeignObjectWidget naddr={NADDR} />)
    const box = await settled()
    expect(box.querySelector('h1')?.textContent).toBe('Goal')
    expect([...box.querySelectorAll('[data-block-id]')].map((el) => el.getAttribute('data-block-id'))).toEqual(ids)
  })

  it('saves on leaving with the same ids and the declared format', async () => {
    resolveObject.mockResolvedValue(described())
    applyAction.mockResolvedValue({ ok: true })
    render(<ForeignObjectWidget naddr={NADDR} />)
    const box = await settled()
    const editor = editorOf(box)
    await act(async () => {
      editor.commands.focus('end', { scrollIntoView: false })
      editor.commands.insertContent(' Today.')
      editor.commands.blur()
    })

    await waitFor(() => expect(applyAction).toHaveBeenCalledTimes(1))
    const [args] = applyAction.mock.calls[0]
    expect(args).toMatchObject({ actionId: 'describe-issue', contentFormat: 'estiva-blocks-1' })
    const saved = parseBlockDocument(args.value)
    expect(saved.content.map((b) => b.id)).toEqual(ids)
    expect(JSON.stringify(saved)).toContain('Today.')
  })

  it('publishes nothing when leaving without a change', async () => {
    resolveObject.mockResolvedValue(described())
    render(<ForeignObjectWidget naddr={NADDR} />)
    const box = await settled()
    const editor = editorOf(box)
    await act(async () => {
      editor.commands.focus('end', { scrollIntoView: false })
      editor.commands.blur()
    })
    expect(applyAction).not.toHaveBeenCalled()
  })

  it('says why a refused save was refused, and keeps the text', async () => {
    resolveObject.mockResolvedValue(described())
    applyAction.mockResolvedValue({ ok: false, reason: 'Only members of this Folder can edit it.' })
    render(<ForeignObjectWidget naddr={NADDR} />)
    const box = await settled()
    const editor = editorOf(box)
    await act(async () => {
      editor.commands.focus('end', { scrollIntoView: false })
      editor.commands.insertContent(' Today.')
      editor.commands.blur()
    })
    expect(await screen.findByText('Only members of this Folder can edit it.')).toBeInTheDocument()
    expect(box.textContent).toContain('Today.')
  })

  it('publishes nothing while typing when the card re-renders', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const onAct = vi.fn(async () => true)
    const { rerender } = render(<ForeignObjectCard object={described()} onAct={onAct} />)
    const editor = editorOf(await settled())
    await act(async () => {
      editor.commands.focus('end', { scrollIntoView: false })
      editor.commands.insertContent(' Today.')
    })
    // A conversation re-renders its cards all the time; each one is a new `onAct`.
    rerender(<ForeignObjectCard object={described()} onAct={async () => true} />)
    rerender(<ForeignObjectCard object={described()} onAct={onAct} />)
    expect(onAct).not.toHaveBeenCalled()
  })

  it('offers no editor over a value it cannot show', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    // No body slot, and the field holds something: an empty editor would replace it on the first save.
    const held = { ...describeIssue, current: stored }
    const { container, rerender } = render(
      <ForeignObjectCard object={described({ slots: { title: { value: 'Payments' } }, actions: [held] })} onAct={() => {}} />,
    )
    expect(container.querySelector('.ProseMirror')).toBeNull()
    // Really empty: the editor stands where the body would.
    rerender(<ForeignObjectCard object={described({ slots: { title: { value: 'Payments' } } })} onAct={() => {}} />)
    expect(await screen.findByRole('textbox', { name: 'Edit description' })).toBeInTheDocument()
  })

  it('edits a row on its own page, where Ship itself edits it', async () => {
    // Ship declares an issue a `row`: one line in a message, the subject on its page (MAN-9, on production).
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const onAct = vi.fn(async () => true)
    const { container, rerender } = render(<ForeignObjectCard object={described({ widget: 'row' })} onAct={onAct} />)
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(container.querySelector('[data-foreign-body]')).toBeNull()
    rerender(<ForeignObjectCard object={described({ widget: 'row' })} onAct={onAct} page />)
    const box = await settled()
    expect([...box.querySelectorAll('[data-block-id]')].map((el) => el.getAttribute('data-block-id'))).toEqual(ids)
    const editor = editorOf(box)
    await act(async () => {
      editor.commands.focus('end', { scrollIntoView: false })
      editor.commands.insertContent(' Today.')
      editor.commands.blur()
    })
    await waitFor(() => expect(onAct).toHaveBeenCalledTimes(1))
    const [actionId, value, contentFormat] = onAct.mock.calls[0] as unknown as [string, string, string]
    expect([actionId, contentFormat]).toEqual(['describe-issue', 'estiva-blocks-1'])
    expect(parseBlockDocument(value).content.map((b) => b.id)).toEqual(ids)
  })

  it('on its page, takes the page’s newer object', async () => {
    // Someone else's edit, re-read by the page: the widget must not keep its first copy.
    const edited = serializeBlockDocument(markerTextToBlockDocument('# Goal\n\nChanged in Ship.'))
    const { container, rerender } = render(<ForeignObjectWidget naddr={NADDR} resolved={described({ widget: 'row', actions: [] })} page />)
    expect(container.querySelector('[data-foreign-body] h1')?.textContent).toBe('Goal')
    rerender(
      <ForeignObjectWidget
        naddr={NADDR}
        resolved={described({ widget: 'row', actions: [], slots: { title: { value: 'Payments' }, body: { value: edited, format: 'blocks', field: 'description' } } })}
        page
      />,
    )
    await waitFor(() => expect(container.textContent).toContain('Changed in Ship.'))
  })

  it('draws a row’s body on its own page when there is nothing to write with', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const { container } = render(<ForeignObjectCard object={described({ widget: 'row', actions: [] })} onAct={() => {}} page />)
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(container.querySelector('[data-foreign-body] h1')?.textContent).toBe('Goal')
  })

  it('stays a reading view where there is nothing to write with', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    // Read-only (the topic sidebar), a row, and a body on a field the action does not set.
    const { container, rerender } = render(<ForeignObjectCard object={described()} />)
    expect(container.querySelector('.ProseMirror')).toBeNull()
    rerender(<ForeignObjectCard object={described({ widget: 'row' })} onAct={() => {}} />)
    expect(container.querySelector('.ProseMirror')).toBeNull()
    rerender(
      <ForeignObjectCard
        object={described({ slots: { title: { value: 'Payments' }, body: { value: stored, format: 'blocks', field: 'summary' } } })}
        onAct={() => {}}
      />,
    )
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(container.querySelector('[data-foreign-body] h1')?.textContent).toBe('Goal')
  })
})

/**
 * A title that is a person — RIC-11.
 *
 * Peek's own manifest titles a message by its author: `{ field: "pubkey", as:
 * "pubkey" }`. The card drew `slots.title.value` as text, which for that
 * object is 64 hex characters — the meta line had honoured `isPubkey` since
 * FEE-1 and the title never had to, because Ship titles everything in words.
 */
describe('a person-titled object', () => {
  // Imported lazily, as the body-slot tests do: the mock above must bind first.
  const card = async () => (await import('./ForeignObjectWidget')).ForeignObjectCard
  const message = () =>
    object({
      ref: 'nevent1msg',
      address: undefined,
      naddr: undefined,
      kind: 9,
      widget: ['message', 'card'],
      appName: 'Peek',
      slots: {
        title: { value: 'a'.repeat(64), isPubkey: true },
        body: { value: 'Green. Leaving the pin in place until Monday.' },
      },
      meta: [],
    })

  it('names the author in the title, never the key', async () => {
    const ForeignObjectCard = await card()
    const { container } = render(<ForeignObjectCard object={message()} />)
    expect(container.textContent).toContain('Alice Chen')
    expect(container.textContent).not.toContain('a'.repeat(64))
    expect(container.textContent).toContain('Green. Leaving the pin')
  })

  it('draws the em dash for an author nobody has published a name for', async () => {
    const ForeignObjectCard = await card()
    const { container } = render(<ForeignObjectCard object={{ ...message(), people: {} }} />)
    expect(container.textContent).not.toContain('a'.repeat(64))
    expect(container.textContent).toContain('—')
  })
})

/**
 * A text action is a one-line form (UIG-7: the package's Form, where it was a
 * hand-written <form>). Enter sends the trimmed words and clears the field; an
 * empty field sends nothing; while the object is being written the field is
 * switched off and focus waits on the form instead of falling to the page.
 */
describe('ActionControl, a text action', () => {
  const comment = { id: 'comment', label: 'Comment', control: 'text' } as unknown as import('@estiva-app/interop').ResolvedAction

  it('sends the trimmed words on Enter and clears the field; sends nothing when empty', async () => {
    const { ActionControl } = await import('./ForeignObjectWidget')
    const onAct = vi.fn()
    render(<ActionControl action={comment} onAct={onAct} />)
    const field = screen.getByPlaceholderText('Comment…')
    await userEvent.type(field, '{Enter}')
    expect(onAct).not.toHaveBeenCalled()
    await userEvent.type(field, '  looks good  {Enter}')
    expect(onAct).toHaveBeenCalledWith('comment', 'looks good')
    expect(field).toHaveValue('')
  })

  it('switches the field off while busy, and holds focus on the form', async () => {
    const { ActionControl } = await import('./ForeignObjectWidget')
    const { rerender, container } = render(<ActionControl action={comment} onAct={() => {}} />)
    const field = screen.getByPlaceholderText('Comment…')
    await userEvent.click(field)
    rerender(<ActionControl action={comment} onAct={() => {}} busy />)
    expect(field).toBeDisabled()
    expect(document.activeElement).toBe(container.querySelector('form'))
    rerender(<ActionControl action={comment} onAct={() => {}} />)
    expect(field).not.toBeDisabled()
    expect(document.activeElement).toBe(field)
  })
})
