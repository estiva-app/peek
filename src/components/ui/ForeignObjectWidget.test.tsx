import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ForeignObject } from '@estiva-app/interop'
import { clearUnavailableCards, noteCardAvailability } from '@/lib/unavailableCards'
import { encodeNaddr, markerTextToBlockDocument, parseBlockDocument, serializeBlockDocument } from '@estiva-app/protocol'

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
  // Nothing here is drawn from the copy on the device: `src/wire/copyCardPick.wire.test.tsx` covers that.
  isFromCopy: () => false,
  useForeignObjects: () => ({ resolveObject, applyAction, resolveFolderProject: vi.fn() }),
  // The tab's held answer (OPT-3), reduced to a resolve on mount and on `reload`.
  useHeldObject: (reference: string | null) => {
    const [object, setObject] = useState<unknown>(reference ? 'loading' : null)
    const [failed, setFailed] = useState(false)
    const reload = useCallback(
      () =>
        reference
          ? resolveObject(reference).then(setObject, () => {
              setFailed(true)
              setObject(null)
            })
          : Promise.resolve(),
      [reference],
    )
    useEffect(() => void reload(), [reload])
    return { object, reload, gone: !!reference && object === null && !failed }
  },
  // The assignee picker's option list (PEE-1) — two known people.
  useWorkspaceDirectory: () => ({
    ['a'.repeat(64)]: { displayName: 'Alice Chen' },
    ['b'.repeat(64)]: { displayName: 'Bruno Ferreira' },
  }),
  // `Avatar` resolves portraits through the seam, and a person now has a face.
  useAvatarSrc: () => () => undefined,
  // A description's URL becomes its chip once answered (Widgets); here none names anything.
  knownCardValue: () => undefined,
  // A card after a description's line is the card under a message, and counts its conversation (16acb5bd).
  useConversationBadges: () => ({ counts: {}, unread: {} }),
  askCardValues: async () => undefined,
  useLinkResolver: () => () => undefined,
  // A chip in the body resolves through the seam; here nothing answers, so it draws as it loads.
  useResolvedReferences: () => ({}),
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
  // What a device remembers of unavailable cards (OPT-10) would otherwise carry from one test into the next.
  clearUnavailableCards()
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
    expect(await screen.findByText(/not available/)).toBeInTheDocument()
  })

  it('names an unreachable object by its type when the app declares one', async () => {
    resolveObject.mockResolvedValue(object({ unreachable: true, noun: 'issue' }))
    render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText(/^Issue — not available/)).toBeInTheDocument()
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

    it("draws no summary box on a topic's card — the summary is written in Details (SPEC §6.12)", async () => {
      resolveObject.mockResolvedValue(
        object({
          // What interop 0.57.0 resolves for a bare file: its summary and the
          // action that sets it, a text change with no format.
          kind: 30840,
          slots: { title: { value: 'Billing entry + add payment method' }, subtitle: { value: 'Card first, then the invoice.' } },
          actions: [{ id: 'summarize', label: 'Summary', control: 'text', field: 'summary' }],
        }),
      )
      render(<ForeignObjectWidget naddr={NADDR} layout="card" />)

      expect(await screen.findByText('Card first, then the invoice.')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
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

  // SPEC §13.6.2: the author's `embed` layout, not the manifest's widget. Ship
  // declares an issue a `row` and a project a `card`, so each is asked the other way.
  it('draws an issue its author asked to see detailed as a card', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const { container } = render(<ForeignObjectCard object={object({ widget: 'row', slots: { title: { value: 'Payments' }, body } })} layout="card" />)
    expect(container.querySelector('[data-foreign-body] h1')?.textContent).toBe('Goal')
  })

  it('draws a project its author asked to see compact as a row', async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const { container } = render(<ForeignObjectCard object={object({ kind: 30850, widget: 'card', slots: { title: { value: 'Payments' }, body } })} layout="row" />)
    expect(container.querySelector('[data-foreign-body]')).toBeNull()
    expect(container.textContent).toContain('Payments')
  })
})

/**
 * A block-document body is read, never edited, in Peek: a Ship issue's or
 * project's text is written in Ship or Leaf, a page's and a document's in Leaf
 * (Miky, 2026-10-23; record a-card-changes-what-a-files-app-shares). Its
 * cards are the ones under a message.
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
  it('keeps a bare file’s text read-only although interop declares describe on it (Leaf 1)', async () => {
    // Decided by Miky, 2026-10-13: a page is edited in Leaf, never from a card in Peek.
    const describe = { ...describeIssue, id: 'describe', label: 'Edit text' } as ForeignObject['actions'][number]
    resolveObject.mockResolvedValue(described({ kind: 30840, actions: [describe] }))
    render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText('Goal')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps a Leaf document’s text read-only, and draws no Edit box for it either', async () => {
    // Miky, 2026-10-14: "You should not be able to edit Leaf document (the description) in Peek."
    const edit = { ...describeIssue, id: 'describe', label: 'Edit' } as ForeignObject['actions'][number]
    // The same action declared without a format this version knows: no one-line box over the text either.
    const bare = { ...describeIssue, id: 'describe', label: 'Edit', format: undefined } as unknown as ForeignObject['actions'][number]
    const leaf = { kind: 30842, noun: 'document', appName: 'Leaf', openUrl: 'https://leaf.estiva.app/d/x' }
    resolveObject.mockResolvedValue(described({ ...leaf, actions: [edit] }))
    const { unmount } = render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText('Goal')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    // The card says what it is and is the way into Leaf.
    expect(screen.getByText('Document')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Payments/ }).getAttribute('href')).toBe(leaf.openUrl)
    unmount()

    resolveObject.mockResolvedValue(described({ ...leaf, actions: [bare] }))
    const second = render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText('Goal')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    second.unmount()

    // An empty document: interop drops its body slot, and the format-less action still draws nothing.
    resolveObject.mockResolvedValue(described({ ...leaf, slots: { title: { value: 'Payments', field: 'title' } }, actions: [bare] }))
    render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText('Document')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps a Ship issue’s description read-only on its own page, where Ship declares describe-issue (Miky, 2026-10-23)', async () => {
    // Ship declares an issue a `row`: one line in a message, the subject on its page — the side panel.
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const onAct = vi.fn(async () => true)
    const { container } = render(<ForeignObjectCard object={described({ widget: 'row' })} onAct={onAct} page />)
    expect(container.querySelector('[data-foreign-body] h1')?.textContent).toBe('Goal')
    expect([...container.querySelectorAll('[data-foreign-body] [data-block-id]')].map((el) => el.getAttribute('data-block-id'))).toEqual(ids)
    expect(container.querySelector('.ProseMirror')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    // Nor a one-line Edit box in its place.
    expect(screen.queryByRole('button', { name: 'Edit description' })).toBeNull()
    expect(screen.queryByText('Edit description')).toBeNull()
  })

  it('keeps a Ship project’s description read-only on a card, and an empty one draws no editor where it would be', async () => {
    resolveObject.mockResolvedValue(described())
    const { container, unmount } = render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText('Goal')).toBeInTheDocument()
    expect(container.querySelector('.ProseMirror')).toBeNull()
    unmount()
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    const second = render(<ForeignObjectCard object={described({ slots: { title: { value: 'Payments' } } })} onAct={() => {}} page />)
    expect(second.container.querySelector('.ProseMirror')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
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

  it("draws a lone link as its row, and the card its writer chose in the row's place, for a reader who cannot write (§13.3)", async () => {
    const { ForeignObjectCard } = await import('./ForeignObjectWidget')
    // The card's own object is read by the card; what it draws is the card's business, not this test's.
    resolveObject.mockResolvedValue(null)
    // An address that decodes: one that names nothing is the unreadable row whatever its writer chose.
    const uri = `nostr:${encodeNaddr({ kind: 30851, pubkey: 'a'.repeat(64), identifier: 'payments-1', relays: [] })}`
    const lone = (id: string, embed?: string) => ({ type: 'paragraph', id, content: [{ type: 'text', text: uri, marks: [{ type: 'reference', attrs: { uri, ...(embed ? { embed } : {}) } }] }] })
    // "Show as Card" saves `detailed`; "Show as Row" saves no `embed` at all.
    const body = JSON.stringify({ type: 'doc', content: [lone('p1', 'detailed'), lone('p2')] })
    const object = described({ slots: { title: { value: 'Payments' }, body: { value: body, format: 'blocks' } } })
    const { container, rerender } = render(<ForeignObjectCard object={object} page />)
    expect(container.querySelector('.ProseMirror')).toBeNull()
    // The card in the first line's place, the row in the second's, and no chip left beside either.
    expect(container.querySelectorAll('[data-foreign-body] [data-card="detailed"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-foreign-body] [data-link-row]')).toHaveLength(1)
    expect(container.querySelector('[data-foreign-body] [data-reference]')).toBeNull()
    // As a card (in a message, or in another description) each stays a chip: cards never nest.
    rerender(<ForeignObjectCard object={object} />)
    expect(container.querySelectorAll('[data-foreign-body] [data-reference="pending"]')).toHaveLength(2)
    expect(container.querySelector('[data-foreign-body] [data-card], [data-foreign-body] [data-link-row]')).toBeNull()
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

describe('a chosen card keeps its size while it loads (OPT-10)', () => {
  const issue = encodeNaddr({ kind: 30851, pubkey: 'a'.repeat(64), identifier: 'issue-1', relays: [] })
  const topic = encodeNaddr({ kind: 30840, pubkey: 'a'.repeat(64), identifier: 'topic-1', relays: [] })
  const heightOf = (container: HTMLElement) => (container.querySelector('[data-skeleton-layout]') as HTMLElement | null)?.style.height

  it('holds the height of the card it will become, by layout and kind', () => {
    resolveObject.mockReturnValue(new Promise(() => {}))
    expect(heightOf(render(<ForeignObjectWidget naddr={issue} layout="row" />).container)).toBe('97px')
    expect(heightOf(render(<ForeignObjectWidget naddr={issue} layout="card" />).container)).toBe('229px')
    expect(heightOf(render(<ForeignObjectWidget naddr={topic} layout="card" />).container)).toBe('46px')
  })

  it('says a chosen card whose file is gone is gone, in its place, rather than closing up', async () => {
    resolveObject.mockResolvedValue(null)
    const { container } = render(<ForeignObjectWidget naddr={issue} layout="card" />)
    await waitFor(() => expect(container.textContent).toBe('Issue — not available.'))
  })

  it('does not call a card gone when the read failed', async () => {
    resolveObject.mockRejectedValue(new Error('429'))
    const { container } = render(<ForeignObjectWidget naddr={issue} layout="card" />)
    await waitFor(() => expect(container.querySelector('[data-skeleton-layout]')).toBeNull())
    expect(container.textContent).not.toContain('not available')
  })

  it('remembers a card that was not available, and draws its one-line row from the first paint next time (Miky, 15 Oct)', async () => {
    resolveObject.mockResolvedValue({ ...object(), unreachable: true, noun: 'issue' })
    const first = render(<ForeignObjectWidget naddr={issue} layout="card" />)
    await waitFor(() => expect(first.container.textContent).toContain('not available'))
    first.unmount()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<ForeignObjectWidget naddr={issue} layout="card" />)
    expect(again.container.querySelector('[data-skeleton-layout]')).toBeNull()
    expect(again.container.textContent).toBe('Issue — not available.')
  })

  it('forgets it once the card can be shown again', async () => {
    noteCardAvailability(issue, false)
    resolveObject.mockResolvedValue(object())
    const { container } = render(<ForeignObjectWidget naddr={issue} layout="card" />)
    await waitFor(() => expect(container.querySelector('[data-foreign-object]')).not.toBeNull())
    expect(JSON.parse(localStorage.getItem('peek.unavailable-cards') ?? '[]')).toEqual([])
  })

  it('still draws nothing for a reference no author chose a card for', async () => {
    resolveObject.mockResolvedValue(null)
    const { container } = render(<ForeignObjectWidget naddr={issue} />)
    await waitFor(() => expect(resolveObject).toHaveBeenCalled())
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('never draws a chosen card shorter than its kind is measured at', async () => {
    resolveObject.mockResolvedValue(object({ address: `30851:${'a'.repeat(64)}:issue-1`, naddr: issue }))
    const { container } = render(<ForeignObjectWidget naddr={issue} layout="row" />)
    await waitFor(() => expect(container.querySelector('[data-foreign-object]')).not.toBeNull())
    expect((container.querySelector('[data-foreign-object]') as HTMLElement).style.minHeight).toBe('97px')
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
