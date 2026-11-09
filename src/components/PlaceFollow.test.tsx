/**
 * Who follows a place, as Peek draws it (TEA-6): the list says who chose All
 * and who Important by name, the viewer as "You", and Add offers the
 * workspace's people but never the viewer — they join with the switch.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  usePlaceFollow: () => follow,
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

const directory = {
  [ME]: { displayName: 'QA One' },
  [MIKY]: { displayName: 'Miky' },
  [KATERINA]: { displayName: 'Katerina' },
  [QA2]: { displayName: 'QA Two' },
}

/** The header's switch, pill and dialog, and a stand-in for the ⋮ menu's "Add someone…", shown only when it is offered. */
function Harness({ archived = false, fileArchived = false, place }: { archived?: boolean; fileArchived?: boolean; place?: string }) {
  const team = '33333333-3333-4333-8333-333333333333'
  const controls = usePlaceFollowControls({
    target: { place: { address: place ?? `30840:${MIKY}:brief`, team }, folder: team, archived, fileArchived },
    title: 'Brief',
    me: ME,
    directory,
  })
  return (
    <>
      {controls.switcher}
      {controls.openAdd && (
        <button type="button" onClick={controls.openAdd}>
          Add someone…
        </button>
      )}
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
    await userEvent.click(screen.getByRole('button', { name: 'Add someone…' }))
    await userEvent.type(await screen.findByPlaceholderText('Search people...'), 'QA')
    // An option's text is its avatar's initials, then the name.
    const offered = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    expect(offered.some((text) => text.endsWith('QA Two'))).toBe(true)
    expect(offered.some((text) => text.endsWith('QA One'))).toBe(false)
  })

  // Miky, 6 Nov: you come into a team's chat by joining the team.
  it('on a team’s chat it lists the people and offers no Add, in the dialog or the menu', async () => {
    render(<Harness place={`39000:${MIKY}:33333333-3333-4333-8333-333333333333`} />)
    expect(screen.queryByRole('button', { name: 'Add someone…' })).toBeNull()
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

describe('the switch on an archived place', () => {
  // The package's disabled button keeps focus for its reason, so it says so with aria-disabled.
  const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'

  it('an archived topic in a live team keeps its level, cannot be changed, and offers no Add', () => {
    render(<Harness fileArchived />)
    const switcher = screen.getByRole('button', { name: /change how you follow Brief/ })
    expect(switcher.getAttribute('aria-label')).toMatch(/at Important/)
    expect(isDisabled(switcher)).toBe(true)
    expect(screen.queryByRole('button', { name: 'Add someone…' })).toBeNull()
  })

  it('in an archived team it shows Not following and offers no Add', () => {
    render(<Harness archived />)
    const switcher = screen.getByRole('button', { name: /change how you follow Brief/ })
    expect(switcher.getAttribute('aria-label')).not.toMatch(/at Important/)
    expect(isDisabled(switcher)).toBe(true)
    expect(screen.queryByRole('button', { name: 'Add someone…' })).toBeNull()
  })
})
