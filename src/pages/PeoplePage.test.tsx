/**
 * The People page's rows are the package's NavItem (Katerina, 14 October),
 * through `PersonItem`: each person is a link to their page, a plain click
 * opens it through Peek's router (the kit's `AppProvider`, as `PeekSetup`
 * gives it in the app), a click with a modifier is the browser's, and Hide is
 * on the ⋮ only where hiding can succeed (DMS-6). What Peek's own row did, kept.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DebugProvider } from '@/lib/debug'
import { PeekSetup } from '@/lib/PeekSetup'
import { PeoplePageView, type PeopleListItem } from './PeoplePage'

vi.mock('@/layouts/PeekFrame', () => ({
  PeekFrame: ({ leftPanel }: Record<string, React.ReactNode>) => <section data-testid="left">{leftPanel}</section>,
}))

afterEach(cleanup)

function Probe() {
  return <output data-testid="url">{useLocation().pathname}</output>
}
const url = () => screen.getByTestId('url').textContent

const person = (id: string, name: string, extra: Partial<PeopleListItem> = {}): PeopleListItem => ({
  id,
  name,
  isUnread: false,
  isUrgent: false,
  canHide: true,
  ...extra,
})

function mount({
  selectedId = null as string | null,
  people = [] as PeopleListItem[],
  starred = [] as { id: string; name: string; isUnread?: boolean; isUrgent?: boolean }[],
  inOpenWork = undefined as string[] | undefined,
} = {}) {
  const onHideDm = vi.fn()
  const onToggleOpenWork = vi.fn()
  render(
    <DebugProvider>
      <MemoryRouter initialEntries={['/app/people']}>
        <PeekSetup>
          <PeoplePageView
            loading={false}
            starred={starred}
            people={people}
            selectedId={selectedId}
            onHideDm={onHideDm}
            openWorkActionFor={inOpenWork ? (id) => (inOpenWork.includes(id) ? 'remove' : 'add') : undefined}
            onToggleOpenWork={inOpenWork ? onToggleOpenWork : undefined}
          />
          <Probe />
        </PeekSetup>
      </MemoryRouter>
    </DebugProvider>,
  )
  return { onHideDm, onToggleOpenWork }
}

const linkFor = (name: string) => within(screen.getByTestId('left')).getByText(name).closest('a')!

describe('People rows on NavItem', () => {
  it('each person is a link to their page', () => {
    mount({ people: [person('greg', 'Greg Bothman')], starred: [{ id: 'amie', name: 'Amie Miles' }] })
    expect(linkFor('Greg Bothman').getAttribute('href')).toBe('/app/people/greg')
    expect(linkFor('Amie Miles').getAttribute('href')).toBe('/app/people/amie')
  })

  it('a plain click opens the person’s page, in the list and in Starred', () => {
    mount({ people: [person('greg', 'Greg Bothman')], starred: [{ id: 'amie', name: 'Amie Miles' }] })
    fireEvent.click(linkFor('Greg Bothman'))
    expect(url()).toBe('/app/people/greg')
    fireEvent.click(linkFor('Amie Miles'))
    expect(url()).toBe('/app/people/amie')
  })

  it('a click with Ctrl or Cmd is the browser’s, for a new tab: this page stays where it is', () => {
    mount({ people: [person('greg', 'Greg Bothman')] })
    // `fireEvent` answers false when the click was stopped: then the browser opens no tab.
    expect(fireEvent.click(linkFor('Greg Bothman'), { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(linkFor('Greg Bothman'), { metaKey: true })).toBe(true)
    expect(url()).toBe('/app/people')
  })

  it('the selected person is the current row', () => {
    mount({ selectedId: 'greg', people: [person('greg', 'Greg Bothman'), person('bob', 'Bob Chen')] })
    expect(linkFor('Greg Bothman').getAttribute('aria-current')).toBe('page')
    expect(linkFor('Bob Chen').getAttribute('aria-current')).toBeNull()
  })

  it('Hide is on the ⋮ where hiding can succeed, and hides that person', () => {
    const { onHideDm } = mount({ people: [person('greg', 'Greg Bothman'), person('hallie', 'Hallie Pratt', { canHide: false })] })
    expect(screen.queryByRole('button', { name: 'More options for Hallie Pratt' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More options for Greg Bothman' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Hide conversation/ }))
    expect(onHideDm).toHaveBeenCalledWith('greg')
    expect(url()).toBe('/app/people')
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

describe('the People header', () => {
  // Peek's rule: only offer what can succeed. Both were drawn and did nothing (audit A29, Katerina, 2 November).
  it('offers no Sort by and no New conversation, which do nothing yet', () => {
    mount({ people: [person('greg', 'Greg Bothman')] })
    expect(screen.queryByRole('button', { name: 'Sort by' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New conversation' })).toBeNull()
  })
})

describe('Open work on a person’s ⋮ (Katerina, 30 October)', () => {
  it('a person not in Open work is added from their ⋮, without selecting them', () => {
    const { onToggleOpenWork } = mount({ people: [person('greg', 'Greg Bothman')], inOpenWork: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More options for Greg Bothman' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Open work' }))
    expect(onToggleOpenWork).toHaveBeenCalledWith('greg')
    expect(url()).toBe('/app/people')
  })

  it('a person already in Open work offers Remove instead', () => {
    mount({ people: [person('greg', 'Greg Bothman')], inOpenWork: ['greg'] })
    fireEvent.click(screen.getByRole('button', { name: 'More options for Greg Bothman' }))
    expect(screen.getByRole('menuitem', { name: 'Remove from Open work' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Add to Open work' })).toBeNull()
  })

  it('a starred person has the ⋮ for it too, with Open work and no Hide', () => {
    const { onToggleOpenWork } = mount({ starred: [{ id: 'amie', name: 'Amie Miles' }], inOpenWork: [] })
    fireEvent.click(screen.getByRole('button', { name: 'More options for Amie Miles' }))
    expect(screen.queryByRole('menuitem', { name: /Hide conversation/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Open work' }))
    expect(onToggleOpenWork).toHaveBeenCalledWith('amie')
  })

  it('where adding cannot succeed, no row offers it', () => {
    mount({ people: [person('greg', 'Greg Bothman', { canHide: false })], starred: [{ id: 'amie', name: 'Amie Miles' }] })
    expect(screen.queryByRole('button', { name: /More options/ })).toBeNull()
  })
})
