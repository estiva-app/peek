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

/** The app always passes a delete: the kit's card offers Delete only when there is one. */
const noop = () => {}

async function openMore(node: React.ReactElement) {
  const { container } = render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>{node}</PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  fireEvent.mouseEnter(container.firstElementChild as Element)
  // The kit's card offers ⋯ only when it has a row to show: someone else's reply has none, so no ⋯ at all.
  const more = screen.queryByRole('button', { name: 'More actions' })
  if (more) {
    await userEvent.click(more)
    await screen.findByRole('menu')
  }
  return container
}

const edit = () => screen.queryByRole('menuitem', { name: 'Edit' })
const remove = () => screen.queryByRole('menuitem', { name: 'Delete' })

describe('a message card', () => {
  it('offers Edit and Delete on your own message', async () => {
    const container = await openMore(<ConversationCard onDelete={noop} authorName="You" timestamp="10:24" body="Mine." />)
    expect(edit()).toBeTruthy()
    expect(remove()).toBeTruthy()
    await userEvent.click(edit()!)
    expect(container.querySelector('.ProseMirror')).not.toBeNull()
  })

  it("offers neither on somebody else's", async () => {
    const container = await openMore(<ConversationCard onDelete={noop} authorName="Katerina Kelepouri" timestamp="10:24" body="Hers." />)
    expect(edit()).toBeNull()
    expect(remove()).toBeNull()
    expect(container.querySelector('.ProseMirror')).toBeNull()
  })
})

describe('a reply card', () => {
  it('offers Edit and Delete on your own reply', async () => {
    await openMore(<ReplyCard onDelete={noop} authorName="You" timestamp="10:25" body="My reply." />)
    expect(edit()).toBeTruthy()
    expect(remove()).toBeTruthy()
  })

  it("offers neither on somebody else's", async () => {
    await openMore(<ReplyCard onDelete={noop} authorName="Katerina Kelepouri" timestamp="10:25" body="Her reply." />)
    expect(edit()).toBeNull()
    expect(remove()).toBeNull()
  })
})

// SPEC §6.5: the seam decides, and the label is only the fallback.
describe('a seam that says who may edit', () => {
  it("offers both whenever the seam says so, whatever the label", async () => {
    await openMore(<ConversationCard onDelete={noop} authorName="Helper" canEditAndDelete timestamp="10:24" body="Done." />)
    expect(edit()).toBeTruthy()
    expect(remove()).toBeTruthy()
  })

  it('offers neither when the seam says no, whatever the label', async () => {
    await openMore(<ReplyCard onDelete={noop} authorName="You" canEditAndDelete={false} timestamp="10:25" body="Mine." />)
    expect(edit()).toBeNull()
    expect(remove()).toBeNull()
  })

  it('offers both on a reply when the seam says so', async () => {
    await openMore(<ReplyCard onDelete={noop} authorName="Helper" canEditAndDelete timestamp="10:25" body="Done." />)
    expect(edit()).toBeTruthy()
  })
})
