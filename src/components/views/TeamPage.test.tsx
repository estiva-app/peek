/**
 * A team's page (TEA-5): what it offers depends on who is looking — a member
 * adds someone or leaves, anyone else follows or joins, nobody leaves the
 * Company team, and the only admin is not offered Leave. It shows its places,
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
const file = (kind: number, d: string, title: string) =>
  ({ ref: `${kind}:${PK}:${d}`, address: `${kind}:${PK}:${d}`, kind, folder: 'eng', slots: { title: { value: title } } }) as unknown as ForeignObject
const LAUNCH = file(30840, 'launch', 'Launch')
const ROADMAP = file(30850, 'roadmap', 'Roadmap project')

const api = vi.hoisted(() => ({
  joinTeam: vi.fn(),
  leaveTeam: vi.fn(),
  addToTeam: vi.fn(),
  followTeam: vi.fn(),
  files: [] as ForeignObject[] | null,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  usePeekActions: () => ({ joinTeam: api.joinTeam, leaveTeam: api.leaveTeam, addToTeam: api.addToTeam, followTeam: api.followTeam }),
  useMentionNames: () => [
    { pubkey: ME, name: 'Miky' },
    { pubkey: KATERINA, name: 'Katerina' },
    { pubkey: AGENT, name: 'Claude', bot: true },
    { pubkey: STRANGER, name: 'Zoe' },
  ],
  useTopicsColumn: () => ({ state: { mine: [{ topic: LAUNCH, files: [], archivedFiles: [] }], others: [], archived: [] }, signedOut: false }),
  useTeamFiles: () => ({ files: api.files, failed: false }),
  useMayMove: () => true,
}))
vi.mock('@/components/views/useFolderActions', () => ({ useFolderActions: () => ({ menuFor: () => undefined, action: null, close: () => {} }) }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))

const team = (over: Partial<Team> = {}): Team => ({
  id: 'eng',
  name: 'Engineering',
  archived: false,
  company: false,
  admins: [KATERINA],
  members: [
    { pubkey: KATERINA, role: 'admin' },
    { pubkey: ME },
    { pubkey: AGENT },
  ] as unknown as Team['members'],
  isMember: true,
  isFollowing: false,
  listed: [{ address: LAUNCH.address!, space: true }],
  chat: 'all' as unknown as Team['chat'],
  ...over,
})
const FOLDER = { id: 'eng', name: 'Engineering' } as FolderSummary

function mount(t: Team, viewer = ME) {
  return render(
    <MemoryRouter>
      <TeamPage team={t} folder={FOLDER} folders={[FOLDER]} viewer={viewer} reloadFolders={async () => {}} />
    </MemoryRouter>,
  )
}
const ok = { ok: true } as const

beforeEach(() => {
  vi.clearAllMocks()
  for (const write of [api.joinTeam, api.leaveTeam, api.addToTeam, api.followTeam]) write.mockResolvedValue(ok)
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

  it('Add lists only the people not in the team, and adds the one chosen', async () => {
    mount(team())
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items).toEqual(['Zoe'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Zoe' }))
    expect(api.addToTeam).toHaveBeenCalledWith('eng', STRANGER)
  })

  it('Leave leaves this team', async () => {
    mount(team())
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }))
    expect(api.leaveTeam).toHaveBeenCalledWith('eng')
  })

  it('somebody not in it is offered Follow and Join, and not Add or Leave', async () => {
    mount(team({ isMember: false }), STRANGER)
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Join' }))
    expect(api.joinTeam).toHaveBeenCalledWith('eng')
    await userEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(api.followTeam).toHaveBeenCalledWith('eng', true)
  })

  it('a follower is offered Unfollow, which stops following', async () => {
    mount(team({ isMember: false, isFollowing: true }), STRANGER)
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow' }))
    expect(api.followTeam).toHaveBeenCalledWith('eng', false)
  })

  it('nobody leaves the Company team', () => {
    mount(team({ company: true }))
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy()
  })

  it('the only admin is not offered Leave; another member is', () => {
    const { unmount } = mount(team(), KATERINA)
    expect(screen.queryByRole('button', { name: 'Leave' })).toBeNull()
    unmount()
    mount(team({ admins: [KATERINA, ME] }), KATERINA)
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
    expect(within(places).getByText('Launch')).toBeTruthy()
  })

  it('no chat among the places for somebody not in it', () => {
    mount(team({ isMember: false }), STRANGER)
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
