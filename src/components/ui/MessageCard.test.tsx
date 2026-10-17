import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import type { ForeignObject } from '@estiva-app/interop'
import { encodeNaddr } from '@estiva-app/protocol'
import { clearCardShapes } from '@/lib/cardShapes'
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

const issue = encodeNaddr({ kind: 30851, pubkey: 'a'.repeat(64), identifier: 'issue-1', relays: [] })

function object(summary?: string): ForeignObject {
  return {
    ref: `30851:${'a'.repeat(64)}:issue-1`,
    address: `30851:${'a'.repeat(64)}:issue-1`,
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
  clearCardShapes()
  clearUnavailableCards()
})

describe('an issue card under a message keeps its height while it loads', () => {
  it('holds room for only a title and its pickers on a first draw, as Peek draws an issue with no summary', () => {
    resolveObject.mockReturnValue(new Promise(() => {}))
    const { container } = render(<MessageCard uri={`nostr:${issue}`} />)
    expect(placeholderLines(container)).toBe(2)
  })

  it('holds room for the summary it drew with last time on this device', async () => {
    resolveObject.mockResolvedValue(object('Loads at the height it draws at.'))
    const first = render(<MessageCard uri={`nostr:${issue}`} />)
    await waitFor(() => expect(first.container.textContent).toContain('Loads at the height it draws at.'))
    first.unmount()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<MessageCard uri={`nostr:${issue}`} />)
    expect(placeholderLines(again.container)).toBe(3)
  })

  it('draws "not available." from the first paint for a card this device found not available', async () => {
    resolveObject.mockResolvedValue({ ...object(), unreachable: true, noun: 'issue' })
    const first = render(<MessageCard uri={`nostr:${issue}`} />)
    await waitFor(() => expect(first.container.textContent).toContain('not available'))
    first.unmount()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<MessageCard uri={`nostr:${issue}`} />)
    expect(again.container.querySelector('[aria-busy]')).toBeNull()
    expect(again.container.textContent).toContain('not available.')
  })
})
