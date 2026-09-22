/**
 * A Convex topic's cards offer nothing to change — CON-8, *Stop writing
 * messages to Convex*.
 *
 * The mutations refuse topic writes; these pin the other half, that the page
 * does not offer an action that can only fail (CLAUDE.md, "Only offer actions
 * that can succeed"). Hovering draws no menu, and a reaction pill is not a
 * button that toggles anything.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider, type ReactionData } from '@/api'
import { ConversationCard } from './ConversationCard'
import { ThreadReplyCard } from './ThreadReplyCard'

function hover(node: React.ReactElement) {
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>{node}</PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  fireEvent.mouseEnter(container.firstElementChild as Element)
  return container
}

const reactions: ReactionData[] = [{ emoji: '👍', count: 1, owner: 'others', names: ['Katerina'] }]

describe('a read-only message card', () => {
  it('draws the hover menu when it is not read-only — the control', () => {
    hover(<ConversationCard authorName="You" timestamp="10:24" body="Mine." />)
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeNull()
  })

  it('draws no hover menu, even on your own message', () => {
    hover(<ConversationCard authorName="You" timestamp="10:24" body="Mine." readOnly />)
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('does not toggle a reaction', () => {
    const onReactionsChange = vi.fn()
    hover(
      <ConversationCard authorName="You" timestamp="10:24" body="Mine." reactions={reactions} onReactionsChange={onReactionsChange} readOnly />,
    )
    fireEvent.click(screen.getByText('👍'))
    expect(onReactionsChange).not.toHaveBeenCalled()
  })
})

describe('a read-only reply card', () => {
  it('draws no hover menu', () => {
    hover(<ThreadReplyCard authorName="You" timestamp="10:24" body="Mine." readOnly />)
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('does not toggle a reaction', () => {
    const onReactionsChange = vi.fn()
    hover(<ThreadReplyCard authorName="You" timestamp="10:24" body="Mine." reactions={reactions} onReactionsChange={onReactionsChange} readOnly />)
    fireEvent.click(screen.getByText('👍'))
    expect(onReactionsChange).not.toHaveBeenCalled()
  })
})
