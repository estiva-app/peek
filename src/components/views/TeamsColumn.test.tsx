/**
 * Peek's Teams column as the navigation prototype draws it (Katerina, 16 November; the decisions' step 3): the teams
 * you are in and the ones you follow together, the Company team first, with no label over them; each a row that opens
 * its page and folds its chat, its topics (#, today's spaces), the initiatives it leads (◎, today's topics; T-14 as
 * Katerina changed it on 16 November) and its Files; the other teams in one fold with its count.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { Team } from '@/api'
import { TeamsColumnView } from './TeamsColumn'
import { TreeRow } from './FileTreeView'

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
  chatAddress: `39000:${PK}:${id}`,
  chat: 'none' as unknown as Team['chat'],
  ...over,
})

const ENGINEERING = team('eng', 'Engineering', {
  isMember: true,
  listed: [
    { address: LAUNCH.address!, space: false },
    { address: GENERAL.address!, space: true },
    { address: ISSUE, space: false },
    { address: OLD.address!, space: true },
  ],
})
// Listed among its follows too: being in it says more, so it is drawn once.
const DESIGN = team('design', 'Design', { isMember: true, isFollowing: true })
const SALES = team('sales', 'Sales', { isFollowing: true, listed: [{ address: HIRING.address!, space: true }] })
const LEGAL = team('legal', 'Legal')
const COMPANY = team('co', 'Acme', { isMember: true, company: true })

const TOPICS = new Map([GENERAL, LAUNCH, HIRING, OLD].map((t) => [t.address!, t]))

function mount(props: Partial<Parameters<typeof TeamsColumnView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <TeamsColumnView teams={[SALES, LEGAL, ENGINEERING, DESIGN, COMPANY]} topics={TOPICS} chatUnread={{}} unread={{}} {...props} />
    </MemoryRouter>,
  )
}

/** Every row's name, in the order the column draws them. */
const rows = () => screen.getAllByRole('link').map((link) => link.textContent?.trim())
/** A row's link by its name: exact, or a pattern where a chip it holds is part of it. */
const row = (name: string | RegExp) => screen.getByRole('link', { name })
/** The block a row's own controls sit in: the nearest one around its link that holds a ⋮. */
const rowBlock = (name: string | RegExp, button: string | RegExp) => {
  let block: HTMLElement = row(name)
  while (!within(block).queryByRole('button', { name: button })) block = block.parentElement!
  return block
}

describe('the Teams column (step 3)', () => {
  it('lists your teams and the ones you follow together, the Company team first, with no label over them', () => {
    mount()
    const order = rows()
    expect(order.indexOf('Acme')).toBe(0)
    // A–Z after the Company team, the followed Sales among them; Legal is in the fold.
    expect(order.indexOf('Design')).toBeLessThan(order.indexOf('Engineering'))
    expect(order.indexOf('Engineering')).toBeLessThan(order.indexOf('Sales'))
    expect(screen.queryByText('My teams')).toBeNull()
    expect(screen.queryByText('Following')).toBeNull()
  })

  it('a team’s row opens its page', () => {
    mount()
    expect(row('Engineering').getAttribute('href')).toBe('/app/teams/eng')
  })

  it('under a team you are in: its chat, its topics, then the initiatives it leads (T-14, changed 16 November); no issue, no archived topic', () => {
    mount()
    const order = rows()
    const at = order.indexOf('Engineering')
    expect(order.slice(at, at + 4)).toEqual(['Engineering', 'engineering', 'General', 'Launch'])
    expect(screen.queryByRole('link', { name: 'Old plans' })).toBeNull()
    expect(row('engineering').getAttribute('href')).toBe('/app/teams/eng/chat')
  })

  it('a topic wears #, an initiative ◎: each kind its own icon', () => {
    mount()
    expect(row('General').querySelector('svg.tabler-icon-hash')).not.toBeNull()
    expect(row('Launch').querySelector('svg.tabler-icon-target')).not.toBeNull()
    expect(row('Launch').querySelector('svg.tabler-icon-hash')).toBeNull()
  })

  it('the Company team’s chat is #general (Q-17)', () => {
    mount()
    expect(row('general').getAttribute('href')).toBe('/app/teams/co/chat')
  })

  it('a team you follow lists its topics, and never its chat', () => {
    mount()
    expect(row('Hiring')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'sales' })).toBeNull()
  })

  it('a team with only its chat draws nothing more', () => {
    mount()
    const order = rows()
    const at = order.indexOf('Design')
    expect(order.slice(at, at + 3)).toEqual(['Design', 'design', 'Engineering'])
    expect(screen.queryByText('No spaces or topics yet')).toBeNull()
  })

  it('the other teams are one fold, a row with its count', () => {
    mount()
    const fold = screen.getByRole('button', { name: /^Other teams/ })
    expect(fold.textContent).toContain('1')
    expect(screen.getByRole('link', { name: 'Legal', hidden: true }).getAttribute('href')).toBe('/app/teams/legal')
  })

  it('the chat row carries the dot when its chat is unread, and only then', () => {
    mount({ chatUnread: { eng: true, design: false } })
    expect(row('engineering').closest('li, div')!.querySelector('[data-unread], [data-unread-dot]')).not.toBeNull()
    expect(row('design').parentElement!.querySelector('[data-unread], [data-unread-dot]')).toBeNull()
  })

  it('the open chat is the current row, and its team is not', () => {
    mount({ openTeam: 'eng', chatOpen: true })
    expect(row('engineering').getAttribute('aria-current')).toBe('page')
    expect(row('Engineering').getAttribute('aria-current')).toBeNull()
  })

  it('a team’s row is current only while its own page is open', () => {
    mount({ openTeam: 'eng' })
    expect(row('Engineering').getAttribute('aria-current')).toBe('page')
  })

  it('Unread keeps only what lights — a lit chat, a lit topic — and the team that holds it', () => {
    mount({ show: 'unread', chatUnread: { design: true }, unread: { [HIRING.ref]: true } })
    expect(rows()).toEqual(['Design', 'design', 'Sales', 'Hiring'])
    expect(screen.queryByText('Other teams')).toBeNull()
  })

  it('Unread keeps a lit initiative under its team', () => {
    mount({ show: 'unread', unread: { [LAUNCH.ref]: true } })
    expect(rows()).toEqual(['Engineering', 'Launch'])
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

describe('a team’s Files fold (T-16)', () => {
  it('is shut at first, and reads nothing until it is opened', async () => {
    const renderFiles = vi.fn(() => <span>the files</span>)
    mount({ renderFiles })
    const fold = screen.getByRole('button', { name: 'Files' })
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(renderFiles).not.toHaveBeenCalled()
    await userEvent.click(fold)
    expect(renderFiles).toHaveBeenCalledWith(ENGINEERING)
  })

  it('opens itself for a file of its team that is open', () => {
    const renderFiles = vi.fn(() => <span>the files</span>)
    mount({ renderFiles, openTeam: 'eng', selectedRef: ISSUE })
    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('aria-expanded')).toBe('true')
    expect(renderFiles).toHaveBeenCalledWith(ENGINEERING)
  })

  it('stays shut while one of its team’s initiatives is open: that row is lit instead', () => {
    const renderFiles = vi.fn(() => <span>the files</span>)
    mount({ renderFiles, openTeam: 'eng', selectedRef: LAUNCH.ref })
    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('aria-expanded')).toBe('false')
    expect(renderFiles).not.toHaveBeenCalled()
  })

  it('a file’s row offers Add to Open work first in its ⋮, as a topic’s does (Katerina, 17 November: T-20 changed back)', async () => {
    const issue = { ref: ISSUE, address: ISSUE, kind: 30851, folder: 'eng', slots: { title: { value: 'Fix login' } } } as unknown as ForeignObject
    mount({ renderFiles: () => <TreeRow file={issue} /> })
    await userEvent.click(screen.getByRole('button', { name: 'Files' }))
    await userEvent.click(within(rowBlock('Fix login', 'More options')).getByRole('button', { name: 'More options' }))
    expect((await screen.findAllByRole('menuitem'))[0]?.textContent).toBe('Add to Open work')
  })

  it('shows only under a team that holds a file', () => {
    mount()
    expect(screen.getAllByRole('button', { name: 'Files' })).toHaveLength(1)
  })
})

describe('what a team’s rows offer (step 3)', () => {
  it('a member’s team row offers + to start a topic in it; a followed team’s does not', async () => {
    const onStartTopic = vi.fn()
    mount({ onStartTopic })
    // The kit names the button by its tooltip and its row: "New topic in Engineering: Engineering".
    await userEvent.click(within(rowBlock('Engineering', /^New topic in Engineering/)).getByRole('button', { name: /^New topic in Engineering/ }))
    expect(onStartTopic).toHaveBeenCalledWith(ENGINEERING)
    expect(screen.queryByRole('button', { name: /^New topic in Sales/ })).toBeNull()
  })

  it('a team chat’s ⋮ holds Copy link (Q-25)', async () => {
    const onCopyChatLink = vi.fn()
    mount({ onCopyChatLink })
    await userEvent.click(within(rowBlock('engineering', 'More options for engineering')).getByRole('button', { name: 'More options for engineering' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Copy link'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }))
    expect(onCopyChatLink).toHaveBeenCalledWith(ENGINEERING)
  })

  it('a team chat you are in: Add to Open work first, then Copy link (Katerina, 17 November)', async () => {
    const onToggleChatOpenWork = vi.fn()
    const inChat = { ...ENGINEERING, chat: { kind: 'chat', in: true, ways: ['team'], level: 'important' } as unknown as Team['chat'] }
    mount({ teams: [inChat], onCopyChatLink: vi.fn(), onToggleChatOpenWork, chatInOpenWork: () => false })
    await userEvent.click(within(rowBlock('engineering', 'More options for engineering')).getByRole('button', { name: 'More options for engineering' }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual(['Add to Open work', 'Copy link'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to Open work' }))
    expect(onToggleChatOpenWork).toHaveBeenCalledWith(inChat)
  })

  it('a team chat in Open work offers Remove from Open work', async () => {
    const inChat = { ...ENGINEERING, chat: { kind: 'chat', in: true, ways: ['team'], level: 'important' } as unknown as Team['chat'] }
    mount({ teams: [inChat], onToggleChatOpenWork: vi.fn(), chatInOpenWork: () => true })
    await userEvent.click(within(rowBlock('engineering', 'More options for engineering')).getByRole('button', { name: 'More options for engineering' }))
    expect(await screen.findByRole('menuitem', { name: 'Remove from Open work' })).toBeTruthy()
  })

  it('a member makes one of its topics an initiative (T-31)', async () => {
    const onMarkSpace = vi.fn()
    mount({ onMarkSpace })
    await userEvent.click(within(rowBlock('General', 'More options')).getByRole('button', { name: 'More options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make it an initiative' }))
    expect(onMarkSpace).toHaveBeenCalledWith(ENGINEERING, GENERAL, false)
  })

  it('a member makes one of its initiatives a topic (T-31)', async () => {
    const onMarkSpace = vi.fn()
    mount({ onMarkSpace })
    await userEvent.click(within(rowBlock('Launch', 'More options')).getByRole('button', { name: 'More options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make it a topic' }))
    expect(onMarkSpace).toHaveBeenCalledWith(ENGINEERING, LAUNCH, true)
  })

  it('a topic the viewer hears from offers Leave', async () => {
    const onControl = vi.fn()
    mount({ onControl, leavesOf: (t) => t.address === GENERAL.address })
    await userEvent.click(within(rowBlock('General', 'More options')).getByRole('button', { name: 'More options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Leave' }))
    expect(onControl).toHaveBeenCalledWith('leave', GENERAL)
  })

  it('somebody who only follows the team is not offered the mark', async () => {
    mount({ onMarkSpace: vi.fn(), onControl: vi.fn() })
    await userEvent.click(within(rowBlock('Hiring', 'More options')).getByRole('button', { name: 'More options' }))
    expect((await screen.findAllByRole('menuitem')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: 'Make it an initiative' })).toBeNull()
  })

  it('a topic at Not following says so on its row (Q-22); the others say nothing of their level', () => {
    mount({ notFollowingOf: (_team, t) => t.address === HIRING.address })
    // The chip is in the row's link, so the row reads "Hiring Not following" to a screen reader too.
    expect(within(rowBlock(/^Hiring/, 'More options')).getByText('Not following')).toBeTruthy()
    expect(screen.getAllByText('Not following')).toHaveLength(1)
  })
})
