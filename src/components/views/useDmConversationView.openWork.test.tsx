/**
 * A DM goes into Open work from its own header's ⋮ (Katerina, 30 October), as
 * a file does from its page. Until then the Screener's Open was the only way
 * in, so a DM read before it was triaged could never be added.
 *
 * The conversation itself is stood in for: what this pins is the header's menu
 * and the list it changes.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { useDmConversationView } from './useDmConversationView'

const list = vi.hoisted(() => ({
  ids: new Set<string>(),
  add: vi.fn(),
  remove: vi.fn(),
  mounted: true,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useStarred: () => ({ isDmStarred: () => false, toggleDm: vi.fn() }),
  useDmChannels: () => ({ state: 'present', channelOf: () => 'channel-1', ensureChannel: vi.fn() }),
  useDmVisibility: () => ({ state: 'present', isDmHidden: () => false, reopenDm: vi.fn() }),
  useOpenWorkDms: () =>
    list.mounted ? { has: (id: string) => list.ids.has(id), add: list.add, remove: list.remove } : null,
}))
vi.mock('@/lib/useMarkRead', () => ({ useMarkDmRead: () => {} }))
vi.mock('./useFileConversationView', () => ({
  useFileConversationView: () => ({ conversationParts: { children: <div /> }, threadPanel: undefined, replyOnlyThread: undefined }),
}))

afterEach(() => {
  cleanup()
  list.ids = new Set()
  list.add.mockClear()
  list.remove.mockClear()
  list.mounted = true
})

function Dm() {
  return <>{useDmConversationView({ dmId: 'dm-1', dmName: 'Cleo' }).rightPanel}</>
}

function mount() {
  render(
    <DebugProvider>
      <LastSelectionProvider>
        <MemoryRouter>
          <Dm />
        </MemoryRouter>
      </LastSelectionProvider>
    </DebugProvider>,
  )
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

describe('Open work on a DM’s header (Katerina, 30 October)', () => {
  it('a DM not in Open work is added from the header’s ⋮', () => {
    mount()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Open work' }))
    expect(list.add).toHaveBeenCalledWith('dm-1')
    expect(list.remove).not.toHaveBeenCalled()
  })

  it('a DM in Open work is taken off from it', () => {
    list.ids = new Set(['dm-1'])
    mount()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Open work' }))
    expect(list.remove).toHaveBeenCalledWith('dm-1')
  })

  it('where adding cannot succeed, the header offers no Open work', () => {
    list.mounted = false
    mount()
    openMenu()
    expect(screen.queryByRole('menuitem', { name: /Open work/ })).toBeNull()
  })
})
