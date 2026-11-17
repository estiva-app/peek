/**
 * The rail's Initiatives, Teams and Desk go back to what was open there, as
 * DMs goes back to the last DM (Katerina, 5 October; kept 16 November); a
 * file's page lights the one whose column it shows (TOP-4). Topics and People
 * are Initiatives and DMs since the navigation prototype (16 November).
 */
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LastSelectionProvider, useLastSelection } from '@/lib/lastSelection'
import { clearRailMemory } from '@/lib/railMemory'
import { NavRail } from './NavRail'

function Opened({ topics, folders, desk, dm, column }: { topics?: string; folders?: string; desk?: string; dm?: string; column?: 'topics' | 'folders' }) {
  const { setLastTopicsPath, setLastFoldersPath, setLastDesk, setLastDmId, setFileColumn } = useLastSelection()
  useEffect(() => setLastDmId(dm ?? null), [dm, setLastDmId])
  useEffect(() => setLastTopicsPath(topics ?? null), [topics, setLastTopicsPath])
  useEffect(() => setLastFoldersPath(folders ?? null), [folders, setLastFoldersPath])
  useEffect(() => setLastDesk(desk === undefined ? null : { search: desk }), [desk, setLastDesk])
  useEffect(() => setFileColumn(column ?? null), [column, setFileColumn])
  return null
}

/** Where the router is, and the column its history entry holds. */
function Here() {
  const { pathname, state } = useLocation()
  return <output data-testid="here">{`${pathname} ${(state as { column?: string } | null)?.column ?? '-'}`}</output>
}

function mount(opened: Parameters<typeof Opened>[0], at = '/app/dms') {
  render(
    <MemoryRouter initialEntries={[at]}>
      <LastSelectionProvider>
        <Opened {...opened} />
        <NavRail />
        <Here />
      </LastSelectionProvider>
    </MemoryRouter>,
  )
}
const hrefOf = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
const lit = (name: string) => screen.getByRole('link', { name }).getAttribute('aria-current') === 'page'

// "Folders" until the Teams stage (TEA-5): the rail says Teams, and its route stays /app/teams.
describe('the rail’s four sections', () => {
  it('read Desk, Initiatives, Teams and DMs, in that order', () => {
    mount({})
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Desk', 'Initiatives', 'Teams', 'DMs'])
    expect(hrefOf('DMs')).toBe('/app/dms')
  })

  it('light DMs on a DM', () => {
    mount({}, '/app/dms/abc')
    expect(lit('DMs')).toBe(true)
  })
})

describe('the rail’s Initiatives and Teams', () => {
  it('lead to their own screens when no file was open there', () => {
    mount({})
    expect(hrefOf('Initiatives')).toBe('/app/initiatives')
    expect(hrefOf('Teams')).toBe('/app/teams')
  })

  it('each lead back to the file last open under it', () => {
    mount({ topics: '/topic/release-notes-abc', folders: '/issue/fix-the-rail-def' })
    expect(hrefOf('Initiatives')).toBe('/topic/release-notes-abc')
    expect(hrefOf('Teams')).toBe('/issue/fix-the-rail-def')
  })

  it('a file’s page lights the one whose column it shows, and only that one', () => {
    mount({ column: 'topics' }, '/issue/fix-the-rail-def')
    expect(lit('Initiatives')).toBe(true)
    expect(lit('Teams')).toBe(false)
  })

  it('a file’s page opened from Teams lights Teams', () => {
    mount({ column: 'folders' }, '/topic/release-notes-abc')
    expect(lit('Teams')).toBe(true)
    expect(lit('Initiatives')).toBe(false)
  })

  // "When I navigate to Topics and try to go back to Teams, Teams isn't clickable anymore" (Katerina, 15 November):
  // the same file was the last page of both, so Teams' address was the one already open.
  it('Teams opens its last page under Teams, even when Initiatives shows that same file', () => {
    mount({ column: 'topics', topics: '/topic/release-notes-abc', folders: '/topic/release-notes-abc' }, '/topic/release-notes-abc')
    fireEvent.click(screen.getByRole('link', { name: 'Teams' }))
    expect(screen.getByTestId('here').textContent).toBe('/topic/release-notes-abc folders')
    fireEvent.click(screen.getByRole('link', { name: 'Initiatives' }))
    expect(screen.getByTestId('here').textContent).toBe('/topic/release-notes-abc topics')
  })
})

describe('the rail’s Desk', () => {
  it('leads back to the file Desk had open beside its lists', () => {
    mount({ desk: '?open=30851%3Aabc%3Arelease' })
    expect(hrefOf('Desk')).toBe('/app/desk?open=30851%3Aabc%3Arelease')
  })

  it('leads to Desk when nothing was open there', () => {
    mount({})
    expect(hrefOf('Desk')).toBe('/app/desk')
  })
})

// "when i switch pages from the navrail, i need the selection to persist. no matter what" (Katerina, 17 November).
describe('the rail after a reload', () => {
  /** The same tab drawn again from nothing, as a reload draws it: no page has written anything yet. */
  function reload(at = '/app/dms') {
    cleanup()
    render(
      <MemoryRouter initialEntries={[at]}>
        <LastSelectionProvider>
          <NavRail />
          <Here />
        </LastSelectionProvider>
      </MemoryRouter>,
    )
  }

  it('leads every item back to where it was', () => {
    mount({ topics: '/topic/release-notes-abc', folders: '/app/teams/team-1', desk: '?open=30851%3Aabc%3Arelease', dm: 'f00d' }, '/app/desk')
    reload('/app/desk')
    expect(hrefOf('Initiatives')).toBe('/topic/release-notes-abc')
    expect(hrefOf('Teams')).toBe('/app/teams/team-1')
    expect(hrefOf('Desk')).toBe('/app/desk?open=30851%3Aabc%3Arelease')
    expect(hrefOf('DMs')).toBe('/app/dms/f00d')
  })

  it('keeps the column a file was shown in: Teams still opens its file under Teams', () => {
    mount({ topics: '/topic/release-notes-abc', folders: '/topic/release-notes-abc' })
    reload()
    fireEvent.click(screen.getByRole('link', { name: 'Teams' }))
    expect(screen.getByTestId('here').textContent).toBe('/topic/release-notes-abc folders')
  })

  // "yes it should" (Katerina, 17 November): a new tab too.
  it('a new tab leads every item back to where the last tab left it', () => {
    mount({ topics: '/topic/release-notes-abc', folders: '/app/teams/team-1', dm: 'f00d' })
    window.sessionStorage.clear()
    reload()
    expect(hrefOf('Initiatives')).toBe('/topic/release-notes-abc')
    expect(hrefOf('Teams')).toBe('/app/teams/team-1')
    expect(hrefOf('DMs')).toBe('/app/dms/f00d')
  })

  it('after sign-out, every item leads to its own page', () => {
    mount({ topics: '/topic/release-notes-abc', folders: '/app/teams/team-1' })
    clearRailMemory()
    reload()
    expect(hrefOf('Initiatives')).toBe('/app/initiatives')
    expect(hrefOf('Teams')).toBe('/app/teams')
  })
})
