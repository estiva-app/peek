/**
 * Peek's Teams column (TEA-5), as the approved prototype draws it: the teams
 * you are in, the ones you follow, and the rest by name; a team's section is
 * its chat (members only, with its dot), its spaces, then the topics it leads;
 * and a member marks a topic one of its spaces from the row's menu.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { Team } from '@/api'
import { TeamsColumnView } from './TeamsColumn'

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const topic = (d: string, title: string, extra: Partial<ForeignObject> = {}) =>
  ({ ref: `30840:${PK}:${d}`, address: `30840:${PK}:${d}`, kind: 30840, folder: 'f', slots: { title: { value: title } }, ...extra }) as unknown as ForeignObject

const GENERAL = topic('general', 'General')
const LAUNCH = topic('launch', 'Launch')
const HIRING = topic('hiring', 'Hiring')
const OLD = topic('old', 'Old plans', { archived: { at: 1 } } as Partial<ForeignObject>)
const ISSUE = `30851:${PK}:issue-1`

const team = (id: string, name: string, over: Partial<Team> = {}): Team => ({
  id,
  name,
  archived: false,
  company: false,
  private: false,
  admins: [],
  members: [],
  isMember: false,
  isFollowing: false,
  listed: [],
  chat: 'none' as unknown as Team['chat'],
  ...over,
})

const ENGINEERING = team('eng', 'Engineering', {
  isMember: true,
  listed: [
    { address: LAUNCH.address!, space: false },
    { address: GENERAL.address!, space: true },
    { address: ISSUE, space: false },
    { address: OLD.address!, space: false },
  ],
})
// Listed among its follows too: being in it says more, so it is drawn once, among yours.
const DESIGN = team('design', 'design', { isMember: true, isFollowing: true })
const SALES = team('sales', 'Sales', { isFollowing: true, listed: [{ address: HIRING.address!, space: true }] })
const LEGAL = team('legal', 'Legal')

const TOPICS = new Map([GENERAL, LAUNCH, HIRING, OLD].map((t) => [t.address!, t]))

function mount(props: Partial<Parameters<typeof TeamsColumnView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TeamsColumnView teams={[SALES, LEGAL, ENGINEERING, DESIGN]} topics={TOPICS} chatUnread={{}} unread={{}} {...props} />
    </MemoryRouter>,
  )
}

/** A team's section in the column: its heading's link, then everything drawn under it. */
const sectionOf = (name: string) => screen.getByRole('link', { name: `Open ${name}` }).closest('.pb-2')! as HTMLElement
const rowsOf = (section: HTMLElement) => [...section.querySelectorAll('a')].map((a) => a.textContent?.trim()).filter(Boolean)

describe('the Teams column (TEA-5)', () => {
  it('groups the teams you are in, then the ones you follow, then the rest, each by name', () => {
    mount()
    const headings = ['My teams', 'Following', 'Other teams'].map((title) => screen.getByText(title))
    // In that order on the page.
    expect(headings[0].compareDocumentPosition(headings[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(headings[1].compareDocumentPosition(headings[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Yours sorted by name, ignoring case; a followed one is not among yours; another team is its name alone.
    const sections = screen.getAllByRole('link', { name: /^Open / }).map((link) => link.getAttribute('aria-label'))
    expect(sections).toEqual(['Open design', 'Open Engineering', 'Open Sales'])
    expect(screen.getByRole('link', { name: 'Legal' }).getAttribute('href')).toBe('/app/folders/legal')
    expect(screen.queryByRole('link', { name: 'Open Legal' })).toBeNull()
  })

  it('a team’s heading leads to its page', () => {
    mount()
    expect(screen.getByRole('link', { name: 'Open Engineering' }).getAttribute('href')).toBe('/app/folders/eng')
  })

  it('a team you are in shows its chat first, then its spaces, then the topics it leads — no issue, no archived topic', () => {
    mount()
    expect(rowsOf(sectionOf('Engineering'))).toEqual(['Engineering', 'engineering', 'General', 'Launch'])
    const chat = within(sectionOf('Engineering')).getByRole('link', { name: 'engineering' })
    expect(chat.getAttribute('href')).toBe('/app/folders/eng/chat')
  })

  it('a team you follow lists its spaces and topics, and never its chat', () => {
    mount()
    const sales = sectionOf('Sales')
    expect(rowsOf(sales)).toEqual(['Sales', 'Hiring'])
    expect(within(sales).queryByRole('link', { name: 'sales' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'legal' })).toBeNull()
  })

  it('a team with nothing in it says so, and still offers its members its chat', () => {
    mount()
    const design = sectionOf('design')
    expect(within(design).getByRole('link', { name: 'design' })).toBeTruthy()
    expect(within(design).getByText('No spaces or topics yet')).toBeTruthy()
  })

  it('the chat row carries the dot when its chat is unread, and only then', () => {
    mount({ chatUnread: { eng: true, design: false } })
    const lit = within(sectionOf('Engineering')).getByRole('link', { name: 'engineering' })
    const dark = within(sectionOf('design')).getByRole('link', { name: 'design' })
    expect(lit.closest('li, div')!.querySelector('[data-unread], [data-unread-dot]')).not.toBeNull()
    expect(dark.closest('li, div')!.querySelector('[data-unread], [data-unread-dot]')).toBeNull()
  })

  it('the open chat is the current row', () => {
    mount({ openTeam: 'eng', chatOpen: true })
    const chat = within(sectionOf('Engineering')).getByRole('link', { name: 'engineering' })
    expect(chat.getAttribute('aria-current')).toBe('page')
  })

  it('Unread keeps only what lights — a lit chat, a lit topic — and the team that holds it', () => {
    mount({ show: 'unread', chatUnread: { design: true }, unread: { [HIRING.ref]: true } })
    expect(rowsOf(sectionOf('design'))).toEqual(['design', 'design'])
    expect(rowsOf(sectionOf('Sales'))).toEqual(['Sales', 'Hiring'])
    expect(screen.queryByRole('link', { name: 'Open Engineering' })).toBeNull()
    expect(screen.queryByText('Other teams')).toBeNull()
  })

  it('Unread with nothing lit says so', () => {
    mount({ show: 'unread' })
    expect(screen.getByText('Nothing unread.')).toBeTruthy()
  })

  it('no teams at all says so', () => {
    mount({ teams: [] })
    expect(screen.getByText('No teams yet.')).toBeTruthy()
  })
})

describe('marking a space from the Teams column (TEA-5)', () => {
  /** The row's own menu: the nearest block around its link that holds one. */
  const openMenu = async (section: HTMLElement, title: string) => {
    let row: HTMLElement = within(section).getByText(title)
    while (!within(row).queryByRole('button', { name: 'More options' })) row = row.parentElement!
    await userEvent.click(within(row).getByRole('button', { name: 'More options' }))
  }

  it('a member makes one of its topics a space, and a space no longer one', async () => {
    const onMarkSpace = vi.fn()
    mount({ onMarkSpace })
    await openMenu(sectionOf('Engineering'), 'Launch')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Make it a space' }))
    expect(onMarkSpace).toHaveBeenCalledWith(ENGINEERING, LAUNCH, true)
    await openMenu(sectionOf('Engineering'), 'General')
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop being a space' }))
    expect(onMarkSpace).toHaveBeenLastCalledWith(ENGINEERING, GENERAL, false)
  })

  it('somebody who only follows the team is offered neither', async () => {
    mount({ onMarkSpace: vi.fn() })
    // The row still has its menu (Join, Copy link…): what it lacks is the mark.
    await openMenu(sectionOf('Sales'), 'Hiring')
    expect((await screen.findAllByRole('menuitem')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: 'Stop being a space' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Make it a space' })).toBeNull()
  })
})
