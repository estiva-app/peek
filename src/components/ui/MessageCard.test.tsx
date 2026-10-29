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

  it('holds the height it drew at last time, which a summary wrapped to two lines needs (17 Oct, 114 → 134 px)', async () => {
    const issue = issueNaddr('issue-4')
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 134 } as DOMRect)
    resolveObject.mockResolvedValue(object('issue-4', 'A summary long enough to wrap onto a second line in the card.'))
    const first = render(<MessageCard uri={`nostr:${issue}`} />)
    await waitFor(() => expect(first.container.textContent).toContain('A summary long enough'))
    first.unmount()
    measured.mockRestore()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<MessageCard uri={`nostr:${issue}`} />)
    expect((again.container.querySelector('[data-card]') as HTMLElement).style.minHeight).toBe('134px')
  })

  it('draws "not available" from the first paint for a card this device found not available', async () => {
    const issue = issueNaddr('issue-3')
    resolveObject.mockResolvedValue({ ...object('issue-3'), unreachable: true, noun: 'issue' })
    const first = render(<MessageCard uri={`nostr:${issue}`} />)
    await waitFor(() => expect(first.container.textContent).toContain('not available'))
    first.unmount()
    resolveObject.mockReturnValue(new Promise(() => {}))
    const again = render(<MessageCard uri={`nostr:${issue}`} />)
    expect(again.container.querySelector('[aria-busy]')).toBeNull()
    expect(again.container.textContent).toContain('not available')
  })
})

/** A project of nine issues, three Done and one Cancelled; issue 9 changed last, issue 1 first. */
function project(identifier: string): ForeignObject {
  const statuses = [['Done', 'green'], ['Todo', 'neutral'], ['Done', 'green'], ['Cancelled', 'muted'], ['Todo', 'neutral'], ['In Progress', 'blue'], ['Done', 'green'], ['Todo', 'neutral'], ['Todo', 'neutral']]
  return {
    ...object(identifier, 'What the project is for.'),
    ref: `30850:${'a'.repeat(64)}:${identifier}`,
    address: `30850:${'a'.repeat(64)}:${identifier}`,
    naddr: encodeNaddr({ kind: 30850, pubkey: 'a'.repeat(64), identifier, relays: [] }),
    kind: 30850,
    widget: 'card',
    slots: { title: { value: 'Project one', field: 'title' }, subtitle: { value: 'What the project is for.', field: 'summary' } },
    meta: [{ value: 'ABC', field: 'key' }],
    children: statuses.map(([status, colour], i) => ({
      ...object(`${identifier}-issue-${i + 1}`),
      slots: { title: { value: `Issue ${i + 1}`, field: 'title' }, status: { value: status, colour, field: 'status' } },
      meta: [{ value: `ABC-${i + 1}`, field: 'ref' }],
      changedAt: 1_000 + i,
    })),
  } as unknown as ForeignObject
}

describe('a project linked in a message', () => {
  it('draws its key, its 7 most recently changed issues and how many of all nine are done', async () => {
    const naddr = encodeNaddr({ kind: 30850, pubkey: 'a'.repeat(64), identifier: 'project-1', relays: [] })
    resolveObject.mockResolvedValue(project('project-1'))
    const { container, getByText } = render(<MessageCard uri={`nostr:${naddr}`} />)
    await waitFor(() => expect(container.textContent).toContain('Project one'))
    // The key under the title, with what it is (ui 0.91.0).
    expect(getByText('ABC · Project')).toBeTruthy()
    const issues = [...container.textContent!.matchAll(/Issue (\d)/g)].map((m) => Number(m[1]))
    expect(issues).toEqual([9, 8, 7, 6, 5, 4, 3])
    expect(getByText('3/9')).toBeTruthy()
  })

  it('shows its key in a sentence', async () => {
    const { MessageChip } = await import('./MessageLinks')
    const naddr = encodeNaddr({ kind: 30850, pubkey: 'a'.repeat(64), identifier: 'project-2', relays: [] })
    const { getByText } = render(<MessageChip uri={`nostr:${naddr}`} object={project('project-2')} />)
    expect(getByText('ABC')).toBeTruthy()
  })
})
