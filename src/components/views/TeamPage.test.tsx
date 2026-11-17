/**
 * A team's page (TEA-5) as the navigation prototype draws it (Katerina, 16 November, step 4): what it offers depends on
 * who is looking — a member adds someone or leaves from the Members dialog (its only owner too), anyone else follows or
 * joins from the header, and nobody leaves the Company team. It shows Topics (its chat for a member, then its topics),
 * the Initiatives it leads, and every file it holds, each a list like Explore's with no ⋮; its people are in the
 * Members dialog only. The writes themselves are pinned at the wire in src/wire/teams.wire.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { Team } from '@/api'
import { openedFrom } from '@/lib/openedFrom'
import { TeamPage } from './TeamPage'

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ME = 'a'.repeat(64)
const KATERINA = 'b'.repeat(64)
const AGENT = 'c'.repeat(64)
const STRANGER = 'd'.repeat(64)
const NEWCOMER = 'e'.repeat(64)
const file = (kind: number, d: string, title: string) =>
  ({ ref: `${kind}:${PK}:${d}`, address: `${kind}:${PK}:${d}`, kind, folder: 'eng', slots: { title: { value: title } } }) as unknown as ForeignObject
const LAUNCH = file(30840, 'launch', 'Launch')
const ROADMAP = file(30850, 'roadmap', 'Roadmap project')
const BRIEF = file(30840, 'brief', 'Brief')

const api = vi.hoisted(() => ({
  joinTeam: vi.fn(),
  leaveTeam: vi.fn(),
  addToTeam: vi.fn(),
  followTeam: vi.fn(),
  markSpace: vi.fn(),
  files: [] as ForeignObject[] | null,
  unread: {} as Record<string, boolean>,
  /** How the viewer follows each place, by address: `in` false is Not following. */
  following: {} as Record<string, { in: boolean; level?: string }>,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  usePeekActions: () => ({ joinTeam: api.joinTeam, leaveTeam: api.leaveTeam, addToTeam: api.addToTeam, followTeam: api.followTeam, markSpace: api.markSpace }),
  useMentionNames: () => [
    { pubkey: ME, name: 'Miky' },
    { pubkey: KATERINA, name: 'Katerina' },
    { pubkey: AGENT, name: 'Claude', bot: true },
    { pubkey: STRANGER, name: 'Zoe' },
  ],
  // The company's roster as `usePeople` reads it: the viewer and any service key already left out.
  usePeople: () => [
    { id: KATERINA, pubkey: KATERINA, name: 'Katerina', role: '' },
    { id: AGENT, pubkey: AGENT, name: 'Claude', role: '', bot: true },
    { id: STRANGER, pubkey: STRANGER, name: 'Zoe', role: '' },
    { id: NEWCOMER, pubkey: NEWCOMER, name: 'Yves', role: '' },
  ],
  useTeamTopics: () => ({ topics: new Map([[LAUNCH.address!, LAUNCH], [BRIEF.address!, BRIEF]]), loading: false, signedOut: false }),
  useTeamFiles: () => ({ files: api.files, failed: false }),
  useMayMove: () => true,
  useTeams: () => ({ teams: [], failed: false }),
  useMembership: () => ({ me: ME, state: 'known', isMember: () => false, termsOf: () => ({}), setMember: vi.fn(), refresh: vi.fn() }),
  // Each place's dot, as the rows in the column judge it: lit where a test says.
  useConversationBadges: () => ({ unread: api.unread, news: {}, tones: {}, fills: {} }),
  useTeamChatNews: () => ({ unread: {}, news: {}, tones: {} }),
  // Explore's facts, as its read answers them: four follow Launch, last active an hour before the page opened.
  useTopicFacts: () => ({
    members: new Map([[LAUNCH.address!, 4]]),
    people: new Map([[LAUNCH.address!, ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)]]]),
    active: new Map([[LAUNCH.address!, Math.floor(Date.now() / 1000) - 3600]]),
  }),
  useTeamChatActive: () => undefined,
  usePlaceFollow: () => ({ state: undefined, listed: [{ pubkey: KATERINA, level: 'important', ways: ['team'] }], failed: false, choose: vi.fn(), add: vi.fn() }),
  // How the viewer follows each place, as the rule judges it: where a test says.
  useTopicFollowing: () => (topic: ForeignObject) => (topic.address ? api.following[topic.address] : undefined),
}))
vi.mock('@/components/views/useFolderActions', () => ({ useFolderActions: () => ({ menuFor: () => undefined, action: null, close: () => {} }) }))
/** What the toasts said, in order: each with its Undo when it has one. */
const toasts = vi.hoisted(() => ({ shown: [] as { label: string; actionLabel?: string; onAction?: () => void }[] }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: (toast: { label: string; actionLabel?: string; onAction?: () => void }) => void toasts.shown.push(toast) }) }))

const team = (over: Partial<Team> = {}): Team => ({
  id: 'eng',
  name: 'Engineering',
  chatAddress: '39000::eng',
  archived: false,
  company: false,
  private: false,
  admins: [KATERINA],
  members: [
    { pubkey: KATERINA, role: 'admin' },
    { pubkey: ME },
    { pubkey: AGENT },
  ] as unknown as Team['members'],
  isMember: true,
  isFollowing: false,
  listed: [
    { address: LAUNCH.address!, space: true },
    { id: 'brief', space: false },
  ],
  chat: 'all' as unknown as Team['chat'],
  ...over,
})
const FOLDER = { id: 'eng', name: 'Engineering' } as FolderSummary

function mount(t: Team) {
  return render(
    <MemoryRouter>
      <TeamPage team={t} folder={FOLDER} folders={[FOLDER]} reloadFolders={async () => {}} />
    </MemoryRouter>,
  )
}
const ok = { ok: true } as const

beforeEach(() => {
  vi.clearAllMocks()
  for (const write of [api.joinTeam, api.leaveTeam, api.addToTeam, api.followTeam, api.markSpace]) write.mockResolvedValue(ok)
  api.files = []
  api.unread = {}
  api.following = {}
})

/** The header's Members pill: faces and how many (TP-02). */
const pill = (count = 3) => screen.getByRole('button', { name: new RegExp(String(count)) })
/** Open the Members dialog from the pill. */
const openMembers = async (count = 3) => {
  await userEvent.click(pill(count))
  return screen.getByRole('dialog')
}
/** A list's rows, by their names, in order. */
const rowsOf = (label: string) => [...screen.getByRole('table', { name: label }).querySelectorAll('a')].map((link) => link.textContent?.trim())
/** A place's row, by the start of its name. */
const rowOf = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) }).closest('[role=row], tr') as HTMLElement

describe('a team’s page header (TP-02, TP-04)', () => {
  it('the team’s icon, its name, its dot, and the Members pill', () => {
    mount(team())
    expect(document.querySelector('.tabler-icon-users')).not.toBeNull()
    expect(screen.getByText('Engineering')).toBeTruthy()
    expect(pill()).toBeTruthy()
  })

  it('a member sees no Follow, Join, Add or Leave on the header: Add and their Leave are in Members', async () => {
    mount(team())
    for (const name of ['Join', 'Follow', 'Add', 'Leave']) expect(screen.queryByRole('button', { name })).toBeNull()
    const dialog = await openMembers()
    expect(within(dialog).getByText('Add members')).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: /Leave/ }))
    expect(api.leaveTeam).toHaveBeenCalledWith('eng')
  })

  it('Add members offers only the company’s people not in the team, and adds the one chosen (TEA-11)', async () => {
    mount(team())
    await userEvent.click(within(await openMembers()).getByText('Add members'))
    // "e" is in every name, so only the team filter can leave a member out.
    await userEvent.type(within(screen.getByRole('dialog')).getByPlaceholderText('Search people...'), 'e')
    // An option's text is its avatar's initials, then the name.
    const offered = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    expect(offered.some((text) => text.endsWith('Zoe'))).toBe(true)
    expect(offered.some((text) => text.endsWith('Claude') || text.endsWith('Katerina'))).toBe(false)
    await userEvent.click(screen.getAllByRole('option').find((option) => option.textContent?.endsWith('Zoe'))!)
    // The kit's add layer confirms with "Invite", as on a topic's Members.
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite' }))
    expect(api.addToTeam).toHaveBeenCalledWith('eng', STRANGER)
  })

  it('no Add members once everyone in the company is already in the team (TEA-11)', async () => {
    const everyone = [KATERINA, ME, AGENT, STRANGER, NEWCOMER].map((pubkey) => ({ pubkey }))
    mount(team({ members: everyone as unknown as Team['members'] }))
    expect(within(await openMembers(5)).queryByText('Add members')).toBeNull()
  })

  it('when the relay refuses the first person chosen, Add members stays open on its picker and adds nobody after them (TEA-11)', async () => {
    api.addToTeam.mockReset().mockResolvedValue({ ok: false, reason: 'Refused.' })
    mount(team())
    await userEvent.click(within(await openMembers()).getByText('Add members'))
    const dialog = screen.getByRole('dialog')
    const search = within(dialog).getByPlaceholderText('Search people...')
    for (const name of ['Zoe', 'Yves']) {
      await userEvent.type(search, name)
      await userEvent.click(screen.getAllByRole('option').find((option) => option.textContent?.endsWith(name))!)
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invite' }))
    expect(api.addToTeam).toHaveBeenCalledTimes(1)
    // Still on the picker (its Invite button), not back on the roster.
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Invite' })).toBeTruthy()
  })

  it('somebody not in it is offered Follow and Join on the header, and no Add', async () => {
    mount(team({ isMember: false }))
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(api.joinTeam).toHaveBeenCalledWith('eng')
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(api.followTeam).toHaveBeenCalledWith('eng', true)
    expect(within(await openMembers()).queryByText('Add members')).toBeNull()
  })

  it('Join says so, with Undo that leaves again; Follow the same (Q-10)', async () => {
    toasts.shown.length = 0
    mount(team({ isMember: false }))
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    await waitFor(() => expect(toasts.shown.at(-1)?.label).toBe('You joined Engineering'))
    toasts.shown.at(-1)!.onAction!()
    expect(api.leaveTeam).toHaveBeenCalledWith('eng')
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }))
    await waitFor(() => expect(toasts.shown.at(-1)?.label).toBe('You follow Engineering'))
    toasts.shown.at(-1)!.onAction!()
    expect(api.followTeam).toHaveBeenLastCalledWith('eng', false)
  })

  it('a private team offers no Join: only being added puts someone in it', () => {
    mount(team({ isMember: false, private: true }))
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy()
  })

  it('a follower is offered Unfollow, which stops following', async () => {
    mount(team({ isMember: false, isFollowing: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow' }))
    expect(api.followTeam).toHaveBeenCalledWith('eng', false)
  })

  it('nobody leaves the Company team (TP-16)', async () => {
    mount(team({ company: true }))
    const dialog = await openMembers()
    expect(within(dialog).queryByRole('button', { name: /Leave/ })).toBeNull()
    expect(within(dialog).getByText('Add members')).toBeTruthy()
  })

  it('a team’s only owner is offered Leave, as any other member is', async () => {
    mount(team({ admins: [ME], members: [{ pubkey: ME, role: 'owner' }, { pubkey: KATERINA }, { pubkey: AGENT }] as unknown as Team['members'] }))
    expect(within(await openMembers()).getByRole('button', { name: /Leave/ })).toBeTruthy()
  })

  it('an archived team offers none of them (TP-15)', async () => {
    mount(team({ archived: true }))
    for (const name of ['Join', 'Follow']) expect(screen.queryByRole('button', { name })).toBeNull()
    const dialog = await openMembers()
    expect(within(dialog).queryByRole('button', { name: /Leave/ })).toBeNull()
    expect(within(dialog).queryByText('Add members')).toBeNull()
  })
})

describe('what a team’s page shows (TP-08, TP-09, TP-14)', () => {
  it('Topics: its chat for a member, then its topics; the initiatives it leads apart, under Initiatives', () => {
    mount(team())
    expect(rowsOf('Engineering’s topics')).toEqual(['engineering', 'Launch'])
    expect(rowsOf('Engineering’s initiatives')).toEqual(['Brief'])
    expect(screen.getByRole('link', { name: /^engineering/ }).getAttribute('href')).toBe('/app/teams/eng/chat')
  })

  it('a topic or an initiative opened from the team’s page keeps Teams beside it (Katerina, 17 November, TP-08)', async () => {
    mount(team())
    await userEvent.click(screen.getByRole('link', { name: /^Brief/ }))
    expect(openedFrom(BRIEF.address!)).toBe('folders')
    await userEvent.click(screen.getByRole('link', { name: /^Launch/ }))
    expect(openedFrom(LAUNCH.address!)).toBe('folders')
  })

  it('a team’s topic wears #, an initiative ◎', () => {
    mount(team())
    expect(rowOf('Launch').querySelector('.tabler-icon-hash')).not.toBeNull()
    expect(rowOf('Brief').querySelector('.tabler-icon-target')).not.toBeNull()
  })

  it('a row says how many follow it and when it was last active, as Explore does (TP-09)', () => {
    mount(team())
    expect(rowOf('Launch').textContent).toContain('4')
  })

  // "We need to use the estiva ui component for the members pill"; "clicking on the pill should not show the members list" (Katerina, 17 November).
  it('a row’s members are the kit’s pill, three faces and the number, nothing to press', () => {
    mount(team())
    const pill = within(rowOf('Launch')).getByRole('img', { name: '4 members' })
    expect(pill.tagName).not.toBe('BUTTON')
    expect(pill.querySelectorAll('img, [data-avatar], span[aria-label], [role="img"]').length).toBeGreaterThan(0)
    expect(within(rowOf('Launch')).queryByRole('button', { name: /members/ })).toBeNull()
  })

  it('a lit place carries its dot; the others do not', () => {
    api.unread = { [LAUNCH.ref]: true }
    mount(team())
    expect(rowOf('Launch').querySelector('[data-unread], [data-unread-dot]')).not.toBeNull()
    expect(rowOf('Brief').querySelector('[data-unread], [data-unread-dot]')).toBeNull()
  })

  it('a place you are not following wears the crossed-out bell at its row’s end; one you follow does not (Katerina, 17 November)', () => {
    api.following = { [LAUNCH.address!]: { in: false }, [BRIEF.address!]: { in: true, level: 'important' } }
    mount(team())
    expect(within(rowOf('Launch')).getByRole('img', { name: 'Not following' }).classList.contains('tabler-icon-bell-off')).toBe(true)
    expect(within(rowOf('Brief')).queryByRole('img', { name: 'Not following' })).toBeNull()
  })

  it('no ⋮ on any row, files included (TP-09)', () => {
    api.files = [ROADMAP]
    mount(team())
    expect(screen.queryByRole('button', { name: /More options/ })).toBeNull()
  })

  it('the Company team’s chat reads "general", whatever the team is called (TEA-7)', () => {
    mount(team({ company: true, name: 'Acme' }))
    expect(rowsOf('Acme’s topics')[0]).toBe('general')
  })

  it('no chat among the topics for somebody not in it', () => {
    mount(team({ isMember: false }))
    expect(rowsOf('Engineering’s topics')).toEqual(['Launch'])
  })

  it('its people are in the Members dialog, not on the page (TP-14)', () => {
    mount(team())
    expect(screen.queryByText('Agents')).toBeNull()
    expect(screen.queryByText('Katerina')).toBeNull()
  })

  it('every file it holds, under Files', () => {
    api.files = [ROADMAP]
    mount(team())
    expect(rowsOf('Engineering’s files')).toEqual(['Roadmap project'])
  })

  it('no Files heading when it holds none', () => {
    mount(team())
    expect(screen.queryByText('Files')).toBeNull()
  })
})
