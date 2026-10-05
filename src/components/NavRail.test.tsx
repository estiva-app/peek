/**
 * The rail's Topics and Desk go back to what was open there, as People goes
 * back to the last DM (Katerina, 5 October).
 */
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LastSelectionProvider, useLastSelection } from '@/lib/lastSelection'
import { NavRail } from './NavRail'

function Opened({ path, desk }: { path: string | null; desk?: string }) {
  const { setLastFilePath, setLastDesk } = useLastSelection()
  useEffect(() => setLastFilePath(path), [path, setLastFilePath])
  useEffect(() => setLastDesk(desk === undefined ? null : { search: desk }), [desk, setLastDesk])
  return null
}

function mount(path: string | null, desk?: string, link = 'Topics') {
  render(
    <MemoryRouter initialEntries={['/app/people']}>
      <LastSelectionProvider>
        <Opened path={path} desk={desk} />
        <NavRail />
      </LastSelectionProvider>
    </MemoryRouter>,
  )
  return screen.getByRole('link', { name: link }).getAttribute('href')
}

describe('the rail’s Topics', () => {
  it('leads to the column when no file was open', () => {
    expect(mount(null)).toBe('/app/folders')
  })

  it('leads back to the file last open', () => {
    expect(mount('/topic/release-notes-abc')).toBe('/topic/release-notes-abc')
  })
})

describe('the rail’s Desk', () => {
  it('leads back to the file Desk had open beside its lists', () => {
    expect(mount(null, '?open=30851%3Aabc%3Arelease', 'Desk')).toBe('/app/desk?open=30851%3Aabc%3Arelease')
  })

  it('leads to Desk when nothing was open there', () => {
    expect(mount(null, undefined, 'Desk')).toBe('/app/desk')
  })
})
