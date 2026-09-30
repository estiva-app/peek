/**
 * Edit and Delete only on your own message — PEE-32.
 *
 * The card knows the author only as a label, and every seam labels the
 * viewer's own rows `CURRENT_USER_NAME`. So the two rows show when the label is
 * "You" and not otherwise, in both menus: the message card's and the reply
 * card's, which CON-3 once changed one at a time.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { ConversationCard } from './ConversationCard'
import { ReplyCard } from './ReplyCard'

/* jsdom implements neither `getClientRects` nor `getBoundingClientRect` on
   text nodes, and ProseMirror calls them on every document change. */
beforeAll(() => {
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
  const empty = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  for (const proto of [Element.prototype, Range.prototype] as { getClientRects?: unknown; getBoundingClientRect?: unknown }[]) {
    proto.getClientRects ??= rects
    proto.getBoundingClientRect ??= empty
  }
})

async function openMore(node: React.ReactElement) {
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>{node}</PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  fireEvent.mouseEnter(container.firstElementChild as Element)
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }))
  await screen.findByText('Mark as Highlight')
  return container
}

describe('a message card', () => {
  it('offers Edit and Delete on your own message', async () => {
    const container = await openMore(<ConversationCard authorName="You" timestamp="10:24" body="Mine." />)
    expect(screen.getByText('Edit message')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
    await userEvent.click(screen.getByText('Edit message'))
    expect(container.querySelector('.ProseMirror')).not.toBeNull()
  })

  it("offers neither on somebody else's", async () => {
    const container = await openMore(<ConversationCard authorName="Katerina Kelepouri" timestamp="10:24" body="Hers." />)
    expect(screen.queryByText('Edit message')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
    expect(container.querySelector('.ProseMirror')).toBeNull()
  })
})

describe('a reply card', () => {
  it('offers Edit and Delete on your own reply', async () => {
    await openMore(<ReplyCard authorName="You" timestamp="10:25" body="My reply." />)
    expect(screen.getByText('Edit message')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it("offers neither on somebody else's", async () => {
    await openMore(<ReplyCard authorName="Katerina Kelepouri" timestamp="10:25" body="Her reply." />)
    expect(screen.queryByText('Edit message')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })
})

// SPEC §6.5 (CON-5): a seam that reads profiles decides, and the label is only the fallback.
describe('a seam that says who may edit', () => {
  it("offers both on somebody else's when the seam says so — an agent's message", async () => {
    await openMore(<ConversationCard authorName="Helper" canEditAndDelete timestamp="10:24" body="Done." />)
    expect(screen.getByText('Edit message')).toBeTruthy()
    expect(screen.getByText('Delete')).toBeTruthy()
  })

  it('offers neither when the seam says no, whatever the label', async () => {
    await openMore(<ReplyCard authorName="You" canEditAndDelete={false} timestamp="10:25" body="Mine." />)
    expect(screen.queryByText('Edit message')).toBeNull()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it("offers both on an agent's reply", async () => {
    await openMore(<ReplyCard authorName="Helper" canEditAndDelete timestamp="10:25" body="Done." />)
    expect(screen.getByText('Edit message')).toBeTruthy()
  })
})
