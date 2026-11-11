/**
 * A team's page (TEA-5): what it offers depends on who is looking — a member
 * adds someone or leaves (its only owner too), anyone else follows or joins,
 * and nobody leaves the Company team. It shows its places,
 * its files outside any topic (only when it has some), and its people with
 * agents apart. The writes themselves are pinned at the wire in
 * src/wire/teams.wire.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import type { Team } from '@/api'
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
}))
vi.mock('@/components/views/useFolderActions', () => ({ useFolderActions: () => ({ menuFor: () => undefined, action: null, close: () => {} }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

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
})

describe('a team’s page offers what the viewer may do (TEA-5)', () => {
  it('a member is offered Add and Leave, and not Join or Follow', () => {
    mount(team())
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull()
  })

  it('Add opens the standard Add members dialog, offering only the company’s people not in the team, and adds the one chosen (TEA-11)', async () => {
    api.addToTeam.mockResolvedValue({ ok: true })
    mount(team())
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Add members')).toBeTruthy()
    // "e" is in every name, so only the team filter can leave a member out.
    await userEvent.type(within(dialog).getByPlaceholderText('Search people...'), 'e')
    // An option's text is its avatar's initials, then the name.
    const offered = screen.getAllByRole('option').map((option) => option.textContent ?? '')
    expect(offered.some((text) => text.endsWith('Zoe'))).toBe(true)
    expect(offered.some((text) => text.endsWith('Claude') || text.endsWith('Katerina'))).toBe(false)
    await userEvent.click(screen.getAllByRole('option').find((option) => option.textContent?.endsWith('Zoe'))!)
    // The kit's add layer confirms with "Invite", as on a topic's Members.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Invite' }))
    expect(api.addToTeam).toHaveBeenCalledWith('eng', STRANGER)
  })

  it('no Add once everyone in the company is already in the team (TEA-11)', () => {
    const everyone = [KATERINA, ME, AGENT, STRANGER, NEWCOMER].map((pubkey) => ({ pubkey }))
    mount(team({ members: everyone as unknown as Team['members'] }))
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy()
  })

  it('when the relay refuses the first person chosen, Add members stays open on its picker and adds nobody after them (TEA-11)', async () => {
    api.addToTeam.mockReset().mockResolvedValue({ ok: false, reason: 'Refused.' })
    mount(team())
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
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

  it('Leave leaves this team', async () => {
    mount(team())
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(api.leaveTeam).toHaveBeenCalledWith('eng')
  })

  it('somebody not in it is offered Follow and Join, and not Add or Leave', async () => {
    mount(team({ isMember: false }))
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(api.joinTeam).toHaveBeenCalledWith('eng')
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(api.followTeam).toHaveBeenCalledWith('eng', true)
  })

  it('a private team offers no Join: only being added puts someone in it', () => {
    mount(team({ isMember: false, private: true }))
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Follow' })).toBeTruthy()
  })

  it('a member marks a topic a space, and takes the mark off a space, from its row', async () => {
    mount(team())
    const places = within(screen.getByText(/^Places$/).parentElement as HTMLElement)
    const menuOf = (title: string) => places.getByText(title).closest('[data-tree-row], li, a, div')!.parentElement as HTMLElement
    await userEvent.click(within(menuOf('Launch')).getByRole('button', { name: 'More options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop being a space' }))
    expect(api.markSpace).toHaveBeenCalledWith('eng', LAUNCH.address, false)
    await userEvent.click(within(menuOf('Brief')).getByRole('button', { name: 'More options' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make it a space' }))
    expect(api.markSpace).toHaveBeenCalledWith('eng', BRIEF.address, true)
  })

  it('a follower is offered Unfollow, which stops following', async () => {
    mount(team({ isMember: false, isFollowing: true }))
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow' }))
    expect(api.followTeam).toHaveBeenCalledWith('eng', false)
  })

  it('nobody leaves the Company team', () => {
    mount(team({ company: true }))
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })

  it('a team’s only owner is offered Leave, as any other member is', () => {
    mount(team({ admins: [ME], members: [{ pubkey: ME, role: 'owner' }, { pubkey: KATERINA }] as unknown as Team['members'] }))
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy()
  })

  it('an archived team offers none of them', () => {
    mount(team({ archived: true }))
    for (const name of ['Add', 'Leave', 'Join', 'Follow']) expect(screen.queryByRole('button', { name })).toBeNull()
  })
})

describe('what a team’s page shows (TEA-5)', () => {
  const section = (label: RegExp) => screen.getByText(label).parentElement as HTMLElement

  it('its places: the chat for a member, then its spaces and topics', () => {
    mount(team())
    const places = section(/^Places$/)
    expect(within(places).getByRole('link', { name: 'engineering' }).getAttribute('href')).toBe('/app/folders/eng/chat')
  })

  it('the Company team’s chat reads "general", whatever the team is called (TEA-7)', () => {
    mount(team({ company: true, name: 'Estiva HQ' }))
    const places = section(/^Places$/)
    expect(within(places).getByRole('link', { name: 'general' }).getAttribute('href')).toBe('/app/folders/eng/chat')
    expect(within(places).queryByRole('link', { name: 'estiva hq' })).toBeNull()
    expect(within(places).getByText('Launch')).toBeTruthy()
  })

  it('no chat among the places for somebody not in it', () => {
    mount(team({ isMember: false }))
    expect(within(section(/^Places$/)).queryByRole('link', { name: 'engineering' })).toBeNull()
  })

  it('its people, with its agents apart', () => {
    mount(team())
    expect(screen.getByText('Members · 2')).toBeTruthy()
    expect(within(section(/^Members/)).getByText('Miky')).toBeTruthy()
    expect(within(section(/^Members/)).queryByText('Claude')).toBeNull()
    expect(within(section(/^Agents · 1$/)).getByText('Claude')).toBeTruthy()
  })

  it('its files outside any topic, between its places and its people', () => {
    api.files = [ROADMAP]
    mount(team())
    const files = screen.getByText('Files')
    expect(within(section(/^Files$/)).getByText('Roadmap project')).toBeTruthy()
    expect(screen.getByText('Places').compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(files.compareDocumentPosition(screen.getByText(/^Members/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('no Files heading when it holds none outside its topics', () => {
    mount(team())
    expect(screen.queryByText('Files')).toBeNull()
  })
})
