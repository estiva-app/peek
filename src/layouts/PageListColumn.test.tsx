import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { ListColumnsClosed, PageListColumn } from './PageListColumn'

function Bomb({ defused }: { defused: boolean }) {
  if (!defused) throw new Error('boom')
  return <div>a row</div>
}

/** A page's list column beside its main area, as AppShell's card lays them out. */
function Page({ closed = false, where = 'row' }: { closed?: boolean; where?: 'row' | 'actions' | 'above' }) {
  const [defused, setDefused] = useState(false)
  return (
    <ListColumnsClosed closed={closed}>
      <div data-testid="card">
        <PageListColumn
          title="Topics"
          actions={where === 'actions' ? <Bomb defused={defused} /> : undefined}
          above={where === 'above' ? <Bomb defused={defused} /> : undefined}
        >
          {where === 'row' ? <Bomb defused={defused} /> : <div>a row</div>}
        </PageListColumn>
        <main>
          <button onClick={() => setDefused(true)}>defuse</button>
          the conversation
        </main>
      </div>
    </ListColumnsClosed>
  )
}

/** The column: the card's first child, the element the package's ListColumn draws. */
const column = () => screen.getByTestId('card').firstElementChild as HTMLElement

describe('PageListColumn', () => {
  beforeEach(() => {
    // React logs the caught error; keep test output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['row', 'actions', 'above'] as const)('keeps a crash in its %s inside the column, and the page working', (where) => {
    render(<Page where={where} />)
    const message = screen.getByText(/Something went wrong in the list panel/)
    // Inside the column, under the column's own name — not across the page.
    expect(column().contains(message)).toBe(true)
    expect(column().textContent).toContain('Topics')
    expect(screen.getByText('the conversation')).toBeTruthy()
  })

  it('"Try again" draws the column again', () => {
    render(<Page />)
    fireEvent.click(screen.getByText('defuse'))
    fireEvent.click(screen.getByText('Try again'))
    expect(column().textContent).toContain('a row')
    expect(screen.queryByText(/Something went wrong/)).toBeNull()
  })

  it('closes with the rail, and so does the message', () => {
    const { rerender } = render(<Page closed />)
    expect(column().dataset.collapsed).toBe('true')
    rerender(<Page closed={false} />)
    expect(column().dataset.collapsed).toBeUndefined()
  })

  it('is open with no AppShell around it', () => {
    render(
      <PageListColumn title="Topics">
        <div>a row</div>
      </PageListColumn>,
    )
    expect(screen.getByText('a row')).toBeTruthy()
    expect(document.querySelector('[data-collapsed]')).toBeNull()
  })
})
