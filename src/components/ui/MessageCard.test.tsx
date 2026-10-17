import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'
import { encodeNaddr } from '@estiva-app/protocol'
import { clearUnavailableCards } from '@/lib/unavailableCards'

const resolveObject = vi.fn()

vi.mock('@/api', async () => {
  const { useEffect, useState } = await import('react')
  return {
    hasRelay: true,
    isFromCopy: () => false,
    useForeignObjects: () => ({ resolveObject, applyAction: vi.fn() }),
    // The tab's held answer (OPT-3), reduced to a resolve on mount.
    useHeldObject: (reference: string | null) => {
      const [object, setObject] = useState<unknown>(reference ? 'loading' : null)
      useEffect(() => {
        if (reference) void resolveObject(reference).then(setObject)
      }, [reference])
      return { object, reload: async () => {}, gone: !!reference && object === null }
    },
    useWorkspaceDirectory: () => ({}),
    useConversationBadges: () => ({ counts: {}, unread: {} }),
    useAvatarSrc: () => () => undefined,
  }
})

const { MessageCard } = await import('./MessageLinks')

// Each test its own issue, so what one test's card left on the device does not shape the next one's.
const issueNaddr = (identifier: string) => encodeNaddr({ kind: 30851, pubkey: 'a'.repeat(64), identifier, relays: [] })

function object(identifier: string, summary?: string): ForeignObject {
  const issue = issueNaddr(identifier)
  return {
    ref: `30851:${'a'.repeat(64)}:${identifier}`,
    address: `30851:${'a'.repeat(64)}:${identifier}`,
    eventId: 'e'.repeat(64),
    naddr: issue,
    kind: 30851,
    widget: 'row',
    appName: 'Ship',
    slots: {
      title: { value: 'Cards keep their height', field: 'title' },
      ...(summary ? { subtitle: { value: summary, field: 'summary' } } : {}),
    },
    meta: [],
    actions: [],
  } as unknown as ForeignObject
}

/** The lines the loading card holds room for, top to bottom: the title, a key line, a summary, the pickers. */
function placeholderLines(container: HTMLElement): number | undefined {
  const card = container.querySelector('[aria-busy] > *')
  return card ? card.children.length : undefined
}

beforeEach(() => {
  resolveObject.mockReset()
  clearUnavailableCards()
})

describe('an issue card under a message keeps its height while it loads', () => {
  it('holds room for only a title and its pickers on a first draw, as Peek draws an issue with no summary', () => {
    resolveObject.mockReturnValue(new Promise(() => {}))
    const { container } = render(<MessageCard uri={`nostr:${issueNaddr('issue-1')}`} />)
    expect(placeholderLines(container)).toBe(2)
  })

  it('holds room for the summary it drew with last time on this device', async () => {
    const issue = issueNaddr('issue-2')
    resolveObject.mockResolvedValue(object('issue-2', 'Loads at the height it draws at.'))
    const first = render(<MessageCard uri={`nostr:${issue}`} />)
    await waitFor(() => expect(first.container.textContent).toContain('Loads at the height it draws at.'))
    first.unmount()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<MessageCard uri={`nostr:${issue}`} />)
    expect(placeholderLines(again.container)).toBe(3)
  })

  it('draws "not available." from the first paint for a card this device found not available', async () => {
    const issue = issueNaddr('issue-3')
    resolveObject.mockResolvedValue({ ...object('issue-3'), unreachable: true, noun: 'issue' })
    const first = render(<MessageCard uri={`nostr:${issue}`} />)
    await waitFor(() => expect(first.container.textContent).toContain('not available'))
    first.unmount()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<MessageCard uri={`nostr:${issue}`} />)
    expect(again.container.querySelector('[aria-busy]')).toBeNull()
    expect(again.container.textContent).toContain('not available.')
  })
})
