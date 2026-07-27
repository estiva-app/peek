import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ForeignObject } from '../../../convex/nostr/projection'

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

vi.mock('convex/react', () => ({ useAction: () => resolveObject }))
vi.mock('@/api', () => ({ hasConvex: true }))
vi.mock('../../../convex/_generated/api', () => ({
  api: { nostr: { foreign: { resolveObject: 'resolveObject' } } },
}))

const { ForeignObjectWidget } = await import('./ForeignObjectWidget')

const NADDR = 'naddr1qqjrje33vg6xzvnr95mk2vmy95'

function object(overrides: Partial<ForeignObject> = {}): ForeignObject {
  return {
    address: '30851:abc:issue-1',
    kind: 30851,
    widget: 'row',
    appName: 'Linear-lite',
    slots: {
      title: { value: 'Billing entry + add payment method' },
      status: { value: 'Done', colour: 'green' },
    },
    meta: [{ value: 'PAY-1' }, { label: 'Assignee', value: 'a'.repeat(64), isPubkey: true }],
    comments: [{ id: 'c1', author: 'b'.repeat(64), body: 'Blocked on the Stripe key.', createdAt: 1 }],
    viaRecommendation: true,
    ...overrides,
  }
}

beforeEach(() => resolveObject.mockReset())

describe('ForeignObjectWidget', () => {
  it('renders the declared slots', async () => {
    resolveObject.mockResolvedValue(object())
    render(<ForeignObjectWidget naddr={NADDR} />)

    expect(await screen.findByText('Billing entry + add payment method')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('PAY-1')).toBeInTheDocument()
  })

  it('shows a pubkey as a person, never as 64 hex characters', async () => {
    resolveObject.mockResolvedValue(object())
    render(<ForeignObjectWidget naddr={NADDR} />)

    await screen.findByText('Billing entry + add payment method')
    expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
    expect(screen.getByText(/Assignee:/)).toHaveTextContent('aaaaaaaa…')
  })

  it('shows comments, because the kind belongs to neither app', async () => {
    resolveObject.mockResolvedValue(object())
    render(<ForeignObjectWidget naddr={NADDR} />)
    expect(await screen.findByText('Blocked on the Stripe key.')).toBeInTheDocument()
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
})
