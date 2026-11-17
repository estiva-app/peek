/**
 * How you follow a place (TEA-6), as the navigation prototype draws it (Katerina, 16 November, step 5): Join while you
 * are not in it, the bell while you are, and Who follows — who chose All and who Important by name, the viewer as "You",
 * with Add offering the workspace's people but never the viewer, and your own row holding Leave or Join.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toolbar } from '@estiva-app/ui'
import type { PlaceFollow } from '@/api'
import { usePlaceFollowControls } from './PlaceFollow'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const KATERINA = 'b'.repeat(64)
const QA2 = 'd'.repeat(64)

const follow: PlaceFollow = {
  state: { shown: 'important', againstDefault: false } as PlaceFollow['state'],
  listed: [
    { pubkey: MIKY, level: 'all', ways: ['level'] },
    { pubkey: ME, level: 'important', ways: ['added'] },
  ],
  failed: false,
  choose: vi.fn(async () => ({ ok: true as const })),
  add: vi.fn(async () => ({ ok: true as const })),
}

/** What the toasts said, in order: each with its Undo when it has one. */
const toasts = vi.hoisted(() => ({ shown: [] as { label: string; actionLabel?: string; onAction?: () => void }[] }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: (toast: { label: string; actionLabel?: string; onAction?: () => void }) => void toasts.shown.push(toast) }) }))

const directory = {
  [ME]: { displayName: 'QA One' },
  [MIKY]: { displayName: 'Miky' },
  [KATERINA]: { displayName: 'Katerina' },
  [QA2]: { displayName: 'QA Two' },
}

/** The header's bell, pill and dialog. */
function Harness({ archived = false, fileArchived = false, place }: { archived?: boolean; fileArchived?: boolean; place?: string }) {
  const team = '33333333-3333-4333-8333-333333333333'
  const controls = usePlaceFollowControls({
    follow,
    target: { place: { address: place ?? `30840:${MIKY}:brief`, team }, folder: team, archived, fileArchived },
    title: 'Brief',
    me: ME,
    directory,
  })
  return (
    <>
      {/* In the header's strip, as the page draws it. */}
      <Toolbar aria-label="Actions">{controls.bell}</Toolbar>
      {controls.pill}
      {controls.dialog}
    </>
  )
}

describe('Who follows', () => {
  it('lists who chose All and who Important by name, the viewer as You', async () => {
    render(<Harness />)
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Miky')).toBeTruthy()
    expect(within(dialog).getByText('You')).toBeTruthy()
    expect(within(dialog).queryByText('QA One')).toBeNull()
  })

  it('Add offers the workspace’s people, never the viewer, even one who does not follow it', async () => {
    const listed = follow.listed
    follow.listed = [{ pubkey: MIKY, level: 'all', ways: ['level'] }]
    onTestFinished(() => {
      follow.listed = listed
    })
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /1/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByText(/Add someone/))
    await userEvent.type(await screen.findByPlaceholderText('Search people...'), 'QA')
    // An option's text is its avatar's initials, then the name.
    const offered = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    expect(offered.some((text) => text.endsWith('QA Two'))).toBe(true)
    expect(offered.some((text) => text.endsWith('QA One'))).toBe(false)
  })

  // Miky, 6 Nov: you come into a team's chat by joining the team.
  it('on a team’s chat it lists the people and offers no Add', async () => {
    render(<Harness place={`39000:${MIKY}:33333333-3333-4333-8333-333333333333`} />)
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Miky')).toBeTruthy()
    expect(within(dialog).queryByText(/Add someone/)).toBeNull()
  })

  it('on a topic the dialog offers Add someone', async () => {
    render(<Harness />)
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    expect(within(await screen.findByRole('dialog')).getByText(/Add someone/)).toBeTruthy()
  })
})

describe('the bell (PL-12, PL-14)', () => {
  const choose = follow.choose as ReturnType<typeof vi.fn>
  const at = (shown: 'all' | 'important' | 'not-following') => {
    const was = follow.state
    follow.state = { shown, againstDefault: false, defaultReaches: false }
    onTestFinished(() => {
      follow.state = was
    })
  }

  it('shows the level by its icon, and its menu "Notify me about" in Katerina’s words, the current one ticked', async () => {
    render(<Harness />)
    const bell = screen.getByRole('button', { name: 'Notifications for Brief: Important' })
    expect(bell.querySelector('.tabler-icon-bell')).not.toBeNull()
    await userEvent.click(bell)
    expect(await screen.findByText('Notify me about')).toBeTruthy()
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent)
    expect(items).toEqual([
      expect.stringContaining('Everything'),
      expect.stringContaining('Important'),
      expect.stringContaining('Not following'),
    ])
    expect(items[0]).toContain('Every message, including on its files')
    expect(items[1]).toContain('New conversations, replies to you, and mentions')
    expect(items[2]).toContain('You are only notified when someone names you.')
    // "Everything", not "All" (Q-34); no way back to a team's default (Q-35).
    expect(screen.queryByRole('menuitem', { name: /^All/ })).toBeNull()
    expect(screen.queryByText(/default/)).toBeNull()
  })

  it('a choice writes that level; the current one writes nothing', async () => {
    choose.mockClear()
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /^Notifications for Brief/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Important/ }))
    expect(choose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^Notifications for Brief/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Everything/ }))
    expect(choose).toHaveBeenCalledWith('all')
  })

  it('a choice says what it means here, with Undo back to the level it was (Q-10)', async () => {
    const choose = follow.choose as ReturnType<typeof vi.fn>
    choose.mockClear()
    toasts.shown.length = 0
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /^Notifications for Brief/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Everything/ }))
    await waitFor(() => expect(toasts.shown.at(-1)?.label).toBe('You’ll hear about every message in Brief'))
    expect(toasts.shown.at(-1)?.actionLabel).toBe('Undo')
    toasts.shown.at(-1)!.onAction!()
    expect(choose).toHaveBeenLastCalledWith('important')
  })

  it('rings at Everything', () => {
    at('all')
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Notifications for Brief: Everything' }).querySelector('.tabler-icon-bell-ringing')).not.toBeNull()
  })

  it('on a team’s chat, Everything says only "Every message": a chat lists no files', async () => {
    render(<Harness place={`39000:${MIKY}:33333333-3333-4333-8333-333333333333`} />)
    await userEvent.click(screen.getByRole('button', { name: /^Notifications for Brief/ }))
    const everything = await screen.findByRole('menuitem', { name: /^Everything/ })
    expect(everything.textContent).toContain('Every message')
    expect(everything.textContent).not.toContain('files')
  })
})

describe('not in it: the bell, and no Join button (Katerina, 17 November)', () => {
  const notIn = () => {
    const was = follow.state
    follow.state = { shown: 'not-following', againstDefault: false, defaultReaches: false }
    onTestFinished(() => {
      follow.state = was
    })
  }

  it('a topic you are not in shows the bell at Not following, crossed out, and no Join button', () => {
    notIn()
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Notifications for Brief: Not following' }).querySelector('.tabler-icon-bell-off')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('Important on it joins you there, said as Join said it, with Undo back out (Q-39, Q-10)', async () => {
    notIn()
    const choose = follow.choose as ReturnType<typeof vi.fn>
    choose.mockClear()
    toasts.shown.length = 0
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /^Notifications for Brief/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Important/ }))
    expect(choose).toHaveBeenCalledWith('important')
    await waitFor(() => expect(toasts.shown.at(-1)?.label).toBe('You joined Brief. Notifications: Important.'))
    toasts.shown.at(-1)!.onAction!()
    expect(choose).toHaveBeenLastCalledWith('not-following')
  })

  it('Everything on it joins you at Everything', async () => {
    notIn()
    const choose = follow.choose as ReturnType<typeof vi.fn>
    choose.mockClear()
    toasts.shown.length = 0
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: /^Notifications for Brief/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Everything/ }))
    expect(choose).toHaveBeenCalledWith('all')
    await waitFor(() => expect(toasts.shown.at(-1)?.label).toBe('You joined Brief. Notifications: Everything.'))
  })

  it('a team’s chat you are not in shows no bell and no Join: its team is what you join', () => {
    notIn()
    render(<Harness place={`39000:${MIKY}:33333333-3333-4333-8333-333333333333`} />)
    expect(screen.queryByRole('button', { name: /^Notifications/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
  })

  it('your own row in Who follows still holds Join (PL-10)', async () => {
    notIn()
    const choose = follow.choose as ReturnType<typeof vi.fn>
    choose.mockClear()
    render(<Harness />)
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Join/ }))
    expect(choose).toHaveBeenCalledWith('important')
  })

  it('your own row in Who follows holds Leave, which is Not following (PL-10, Q-40)', async () => {
    const choose = follow.choose as ReturnType<typeof vi.fn>
    choose.mockClear()
    render(<Harness />)
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Leave/ }))
    expect(choose).toHaveBeenCalledWith('not-following')
  })
})

describe('an archived place: no bell, no Join, no Add, no Leave (Q-38)', () => {
  it('an archived topic in a live team: the list still opens, with nothing that changes it', async () => {
    render(<Harness fileArchived />)
    expect(screen.queryByRole('button', { name: /^Notifications/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/Add someone/)).toBeNull()
    expect(within(dialog).queryByRole('button', { name: /Leave/ })).toBeNull()
  })

  it('in an archived team the same', async () => {
    render(<Harness archived />)
    expect(screen.queryByRole('button', { name: /^Notifications/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    await act(async () => screen.getByRole('button', { name: /2/ }).click())
    expect(within(await screen.findByRole('dialog')).queryByText(/Add someone/)).toBeNull()
  })
})
