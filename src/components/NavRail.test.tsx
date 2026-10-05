/**
 * The rail's Topics goes back to the file last open there, as People goes back
 * to the last DM (Katerina, 5 October).
 */
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LastSelectionProvider, useLastSelection } from '@/lib/lastSelection'
import { NavRail } from './NavRail'

function Opened({ path }: { path: string | null }) {
  const { setLastFilePath } = useLastSelection()
  useEffect(() => setLastFilePath(path), [path, setLastFilePath])
  return null
}

function mount(path: string | null) {
  render(
    <MemoryRouter initialEntries={['/app/desk']}>
      <LastSelectionProvider>
        <Opened path={path} />
        <NavRail />
      </LastSelectionProvider>
    </MemoryRouter>,
  )
  return screen.getByRole('link', { name: 'Topics' }).getAttribute('href')
}

describe('the rail’s Topics', () => {
  it('leads to the column when no file was open', () => {
    expect(mount(null)).toBe('/app/folders')
  })

  it('leads back to the file last open', () => {
    expect(mount('/topic/release-notes-abc')).toBe('/topic/release-notes-abc')
  })
})
