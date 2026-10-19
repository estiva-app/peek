/**
 * The People page's rows are the package's NavItem (Katerina, 14 October),
 * through `PersonItem`: each person is a link to their page, a plain click
 * selects them, a click with a modifier is the link's, and Hide is on the ⋮
 * only where hiding can succeed (DMS-6). What Peek's own row did, kept.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DebugProvider } from '@/lib/debug'
import { PeoplePageView, type PeopleListItem } from './PeoplePage'

vi.mock('@/layouts/PeekFrame', () => ({
  PeekFrame: ({ leftPanel }: Record<string, React.ReactNode>) => <section data-testid="left">{leftPanel}</section>,
}))

afterEach(cleanup)

const person = (id: string, name: string, extra: Partial<PeopleListItem> = {}): PeopleListItem => ({
  id,
  name,
  isUnread: false,
  isUrgent: false,
  canHide: true,
  ...extra,
})

function mount({ selectedId = null as string | null, people = [] as PeopleListItem[], starred = [] as { id: string; name: string; isUnread?: boolean; isUrgent?: boolean }[] } = {}) {
  const onSelect = vi.fn()
  const onHideDm = vi.fn()
  render(
    <DebugProvider>
      <MemoryRouter>
        <PeoplePageView
          railClosed={false}
          loading={false}
          starred={starred}
          people={people}
          selectedId={selectedId}
          onSelect={onSelect}
          onHideDm={onHideDm}
        />
      </MemoryRouter>
    </DebugProvider>,
  )
  return { onSelect, onHideDm }
}

const linkFor = (name: string) => within(screen.getByTestId('left')).getByText(name).closest('a')!

describe('People rows on NavItem', () => {
  it('each person is a link to their page', () => {
    mount({ people: [person('greg', 'Greg Bothman')], starred: [{ id: 'amie', name: 'Amie Miles' }] })
    expect(linkFor('Greg Bothman').getAttribute('href')).toBe('/app/people/greg')
    expect(linkFor('Amie Miles').getAttribute('href')).toBe('/app/people/amie')
  })

  it('a plain click selects the person, in the list and in Starred', () => {
    const { onSelect } = mount({ people: [person('greg', 'Greg Bothman')], starred: [{ id: 'amie', name: 'Amie Miles' }] })
    fireEvent.click(linkFor('Greg Bothman'))
    fireEvent.click(linkFor('Amie Miles'))
    expect(onSelect.mock.calls).toEqual([['greg'], ['amie']])
  })

  it('a click with Ctrl or Cmd is the link’s: nothing is selected here', () => {
    const { onSelect } = mount({ people: [person('greg', 'Greg Bothman')] })
    fireEvent.click(linkFor('Greg Bothman'), { ctrlKey: true })
    fireEvent.click(linkFor('Greg Bothman'), { metaKey: true })
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('the selected person is the current row', () => {
    mount({ selectedId: 'greg', people: [person('greg', 'Greg Bothman'), person('bob', 'Bob Chen')] })
    expect(linkFor('Greg Bothman').getAttribute('aria-current')).toBe('page')
    expect(linkFor('Bob Chen').getAttribute('aria-current')).toBeNull()
  })

  it('Hide is on the ⋮ where hiding can succeed, and hides that person', () => {
    const { onHideDm, onSelect } = mount({ people: [person('greg', 'Greg Bothman'), person('hallie', 'Hallie Pratt', { canHide: false })] })
    expect(screen.queryByRole('button', { name: 'More options for Hallie Pratt' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More options for Greg Bothman' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Hide conversation/ }))
    expect(onHideDm).toHaveBeenCalledWith('greg')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('a starred person has no ⋮: Hide is for the list below', () => {
    mount({ starred: [{ id: 'amie', name: 'Amie Miles' }] })
    expect(screen.queryByRole('button', { name: /More options/ })).toBeNull()
  })

  it('unread draws the dot; urgent with it the badge; urgent alone nothing', () => {
    mount({
      people: [
        person('juan', 'Juan Foley', { isUnread: true }),
        person('alice', 'Alice Johnson', { isUnread: true, isUrgent: true }),
        person('jake', 'Jake Walter', { isUrgent: true }),
      ],
    })
    expect(linkFor('Juan Foley').querySelector('[data-unread]')).not.toBeNull()
    expect(linkFor('Alice Johnson').querySelector('[data-urgent]')).not.toBeNull()
    expect(linkFor('Jake Walter').querySelector('[data-unread], [data-urgent]')).toBeNull()
  })
})
