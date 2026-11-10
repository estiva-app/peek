import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ListColumn } from '@estiva-app/ui'
import { RailClosed, useRailClosed } from './railClosed'

/*
  What is Peek's about a page's list column is only where its closed state comes
  from: `PeekFrame`'s menu button, through `RailClosed`. The column itself, and
  what a crash in it does, are the package's `ListColumn`, tested there.
*/

/** A page's list column, as the pages draw it, in the card beside the main area. */
function Column() {
  return (
    <div data-testid="card">
      <ListColumn title="Topics" collapsed={useRailClosed()}>
        <div>a row</div>
      </ListColumn>
    </div>
  )
}

/** The column: the card's first child, the element the package's ListColumn draws. */
const column = () => screen.getByTestId('card').firstElementChild as HTMLElement

describe('the rail-closed context', () => {
  it('closes a page’s list column with the rail, and opens it again', () => {
    const { rerender } = render(
      <RailClosed value={true}>
        <Column />
      </RailClosed>,
    )
    expect(column().dataset.collapsed).toBe('true')
    rerender(
      <RailClosed value={false}>
        <Column />
      </RailClosed>,
    )
    expect(column().dataset.collapsed).toBeUndefined()
  })

  it('leaves the column open with no PeekFrame around it', () => {
    render(<Column />)
    expect(screen.getByText('a row')).toBeTruthy()
    expect(document.querySelector('[data-collapsed]')).toBeNull()
  })
})
