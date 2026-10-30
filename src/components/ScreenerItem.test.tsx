/**
 * A Screener row opens its item when clicked, and so does its hover card
 * (Katerina, 30 October); its buttons and the Later menu keep their own
 * clicks. The menu is a portal — outside the row in the page, but React hands
 * its clicks up to the row all the same.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenerItem } from './ScreenerItem'
import { ScreenerPreviewCardView } from './ScreenerPreviewCard'

const ITEM = { id: 'sc_dm_dm-7', kind: 'dm' as const, dmId: 'dm-7', authorName: 'Cleo', preview: 'A message from Cleo' }
const CARD = <ScreenerPreviewCardView rows={[{ kind: 'message', authorName: 'Cleo', timestamp: '9:14 AM', body: 'The whole message from Cleo' }]} />

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mount() {
  const onRead = vi.fn()
  const onOpen = vi.fn()
  const onLater = vi.fn()
  const onDismiss = vi.fn()
  render(<ScreenerItem item={ITEM} onRead={onRead} onOpen={onOpen} onLater={onLater} onDismiss={onDismiss} preview={CARD} />)
  return { onRead, onOpen, onLater, onDismiss }
}

describe('a Screener row', () => {
  it('opens its item when its words are clicked', () => {
    const { onRead } = mount()
    fireEvent.click(screen.getByText('A message from Cleo'))
    expect(onRead).toHaveBeenCalledWith(ITEM.id)
  })

  it('Open work, Dismiss and a Later choice do their own job and open nothing', async () => {
    const { onRead, onOpen, onLater, onDismiss } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Open work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Tomorrow/ }))
    expect(onOpen).toHaveBeenCalledWith(ITEM.id)
    expect(onDismiss).toHaveBeenCalledWith(ITEM.id)
    expect(onLater).toHaveBeenCalledTimes(1)
    expect(onRead).not.toHaveBeenCalled()
  })

  it('its hover card opens the item too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { onRead } = mount()
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).hover(screen.getByText('A message from Cleo'))
    // Past the card's 350ms wait.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    fireEvent.click(screen.getByText('The whole message from Cleo'))
    expect(onRead).toHaveBeenCalledWith(ITEM.id)
  })
})
