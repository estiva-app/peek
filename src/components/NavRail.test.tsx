/**
 * The rail's Topics, Teams and Desk go back to what was open there, as
 * People goes back to the last DM (Katerina, 5 October); a file's page lights
 * the one whose column it shows (TOP-4).
 */
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LastSelectionProvider, useLastSelection } from '@/lib/lastSelection'
import { NavRail } from './NavRail'

function Opened({ topics, folders, desk, column }: { topics?: string; folders?: string; desk?: string; column?: 'topics' | 'folders' }) {
  const { setLastTopicsPath, setLastFoldersPath, setLastDesk, setFileColumn } = useLastSelection()
  useEffect(() => setLastTopicsPath(topics ?? null), [topics, setLastTopicsPath])
  useEffect(() => setLastFoldersPath(folders ?? null), [folders, setLastFoldersPath])
  useEffect(() => setLastDesk(desk === undefined ? null : { search: desk }), [desk, setLastDesk])
  useEffect(() => setFileColumn(column ?? null), [column, setFileColumn])
  return null
}

function mount(opened: Parameters<typeof Opened>[0], at = '/app/people') {
  render(
    <MemoryRouter initialEntries={[at]}>
      <LastSelectionProvider>
        <Opened {...opened} />
        <NavRail />
      </LastSelectionProvider>
    </MemoryRouter>,
  )
}
const hrefOf = (name: string) => screen.getByRole('link', { name }).getAttribute('href')
const lit = (name: string) => screen.getByRole('link', { name }).getAttribute('aria-current') === 'page'

// "Folders" until the Teams stage (TEA-5): the rail says Teams, and its route stays /app/folders.
describe('the rail’s Topics and Teams', () => {
  it('lead to their own screens when no file was open there', () => {
    mount({})
    expect(hrefOf('Topics')).toBe('/app/topics')
    expect(hrefOf('Teams')).toBe('/app/folders')
  })

  it('each lead back to the file last open under it', () => {
    mount({ topics: '/topic/release-notes-abc', folders: '/issue/fix-the-rail-def' })
    expect(hrefOf('Topics')).toBe('/topic/release-notes-abc')
    expect(hrefOf('Teams')).toBe('/issue/fix-the-rail-def')
  })

  it('a file’s page lights the one whose column it shows, and only that one', () => {
    mount({ column: 'topics' }, '/issue/fix-the-rail-def')
    expect(lit('Topics')).toBe(true)
    expect(lit('Teams')).toBe(false)
  })

  it('a file’s page opened from Teams lights Teams', () => {
    mount({ column: 'folders' }, '/topic/release-notes-abc')
    expect(lit('Teams')).toBe(true)
    expect(lit('Topics')).toBe(false)
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
