import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ForeignObject } from '@estiva-app/interop'

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
vi.mock('@/api', () => ({
  hasConvex: true,
  useForeignObjects: () => ({ resolveObject, applyAction, resolveFolderProject: vi.fn() }),
  // `Avatar` resolves portraits through the seam, and a person now has a face.
  useAvatarSrc: () => () => undefined,
}))

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

  it('names the owning app plainly, even when the handler was a guess', async () => {
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

      // Reports and sets, in one control. The accessible name stays on what
      // pressing it does, which does not change when the holder does.
      const button = await screen.findByRole('button', { name: /Assign to me/ })
      expect(button).toHaveTextContent('Alice Chen')
      // The person *is* the label. "Assign: Alice Chen" captioned a face with
      // the word for what a face is.
      expect(button).not.toHaveTextContent('Assign:')
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
      expect(screen.getByRole('button', { name: /Assign to me/ })).toBeInTheDocument()
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

    it('sends @me rather than a key the browser should never hold', async () => {
      resolveObject.mockResolvedValue(withActions())
      applyAction.mockResolvedValue({ ok: true })
      render(<ForeignObjectWidget naddr={NADDR} />)

      await userEvent.click(await screen.findByRole('button', { name: /Assign to me/ }))
      expect(applyAction).toHaveBeenCalledWith({ naddr: NADDR, actionId: 'assign-issue', value: '@me' })
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
