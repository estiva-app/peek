/**
 * Picking a status on a file's card inside a message opens nothing else — PEE-62.
 *
 * The card's Select draws its options in a portal, outside the message's DOM,
 * and React still bubbles their click up the component tree to the message,
 * which then opened its Replies pane. What is proved: a pick by mouse or by
 * keyboard changes the field and leaves the message unopened, and a click on
 * the message itself still opens it.
 *
 * MessageBody is replaced by a body holding one Select, the shape of a file's
 * card: drawing a real card needs the relay, and what is under test is only
 * the message's click, not the card. The card's own pick is covered by
 * ForeignObjectWidget's tests.
 */
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { Select } from '@/components/ui/Select'

vi.mock('./ui/MessageBody', () => ({
  MessageBody: ({ body }: { body: string }) => {
    const [status, setStatus] = useState('todo')
    return (
      <div>
        <p>{body}</p>
        <Select
          ariaLabel="Change status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'todo', label: 'Todo' },
            { value: 'done', label: 'Done' },
          ]}
        />
      </div>
    )
  },
}))

import { ConversationCard } from './ConversationCard'

function mount() {
  const onClick = vi.fn()
  render(
    <MemoryRouter>
      <DebugProvider>
        <PeekDataProvider>
          <ConversationCard authorName="Katerina" timestamp="10:24" body="Live widget probe" onClick={onClick} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  return onClick
}

describe("picking from a card's Select inside a message", () => {
  it('changes the status with the mouse and does not open the replies', async () => {
    const user = userEvent.setup()
    const onClick = mount()
    await user.click(screen.getByRole('combobox', { name: 'Change status' }))
    await user.click(await screen.findByRole('option', { name: 'Done' }))
    expect(screen.getByRole('combobox', { name: 'Change status' })).toHaveTextContent('Done')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('changes the status with the keyboard and does not open the replies', async () => {
    const user = userEvent.setup()
    const onClick = mount()
    screen.getByRole('combobox', { name: 'Change status' }).focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('option', { name: 'Done' })
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByRole('combobox', { name: 'Change status' })).toHaveTextContent('Done')
    expect(onClick).not.toHaveBeenCalled()
  })

  it("still opens the replies when the message's text is clicked — the control", async () => {
    const user = userEvent.setup()
    const onClick = mount()
    await user.click(screen.getByText('Live widget probe'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
