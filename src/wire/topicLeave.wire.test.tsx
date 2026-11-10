/**
 * Leave on a topic's row in the Topics column, at the wire (TOPI-7): the person opens the row's menu and picks Leave,
 * and what reaches the relay is what the topic page's switch sends for Not following — the place read first, then
 * their leave, or the space written into their private off list. The row, `useFileControls` and `usePeekActions`
 * are the real ones; the fake relay stops at `fetch`, and the toast is the real one the person reads.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { buildMembershipChange, parseTeamsBlob, serializeTeamsBlob, TEAMS_D_TAG } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'
import { useFileControls } from '@/components/views/useFileControls'
import { ToastProvider } from '@/lib/toast'
import { TopicsColumnView } from '@/components/views/TopicsColumn'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))
vi.mock('@/api/internal/openWork', () => ({ useOpenWork: () => ({}), useOpenWorkIfMounted: () => null }))
vi.mock('@/api/internal/screener', () => ({ useScreener: () => ({}) }))

const MIKY = 'a'.repeat(64)
const BUZZ = 'e'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const D = 'd68a8c78-5ec7-4652-b236-89ab57ac5b1e'
const TOPIC = `30840:${MIKY}:${D}`
const T0 = 1_700_000_000

/** The teams this tab holds: the topic's team, which the person is in, leading it as a topic or as a space. */
const held = vi.hoisted(() => ({ space: false, refreshed: 0 }))
const teams = () => [
  { id: TEAM, name: 'Steer', isMember: true, isFollowing: false, archived: false, company: false, admins: [], members: [], listed: [{ address: TOPIC, space: held.space }] },
]
/** What the relay says the person is in, as the row and Leave read it; `refresh` is the re-read after a leave. */
const membership = () => ({
  state: 'known',
  me: ME,
  isMember: () => true,
  termsOf: () => ({ member: true, muted: false }),
  changesOf: () => [],
  isMentioned: () => false,
  refresh: async () => void held.refreshed++,
  setMember: async () => true,
})
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useTeams: () => ({ teams: teams(), failed: false, reload: async () => {} }),
  useMembership: () => membership(),
}))
vi.mock('@/api/useTeams', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/useTeams')),
  useTeams: () => ({ teams: teams(), failed: false, reload: async () => {} }),
}))

const topic = { ref: TOPIC, address: TOPIC, kind: 30840, folder: TEAM, slots: { title: { value: 'Launch' } } } as unknown as ForeignObject
const root = signed({ kind: 30840, created_at: T0, tags: [['d', D], ['h', TEAM], ['title', 'Launch']] }, MIKY)
const roster = signed({ kind: 39002, created_at: T0, tags: [['d', TEAM], ['p', ME], ['p', MIKY]] }, BUZZ)
const asSpace = signed({ kind: 30890, created_at: T0, tags: [['d', TEAM], ['a', TOPIC, '', 'space']] }, BUZZ)
const addedBy = (by: string) => signed({ ...buildMembershipChange(by, (T0 + 10) * 1000, { file: TOPIC, folder: TEAM, person: ME, member: true }), created_at: T0 + 10 }, by)
const teamsList = (off: string[]) =>
  signed({ kind: 30078, created_at: T0, tags: [['d', TEAMS_D_TAG]], content: `fake-nip44:${Buffer.from(serializeTeamsBlob({ teams: {}, off }, 1)).toString('base64')}` })

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  held.space = false
  held.refreshed = 0
})
afterAll(() => vi.unstubAllGlobals())

function Topics() {
  const controls = useFileControls()
  return (
    <>
      <TopicsColumnView state={{ mine: [topic], others: [], archived: [] }} onControl={controls.open} />
      {controls.dialogs}
    </>
  )
}

/** Open the topic's row menu in the Topics column and pick Leave, as the person does. */
async function leaveFromRow() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Topics />
      </ToastProvider>
    </MemoryRouter>,
  )
  let row = document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`) as HTMLElement
  while (!within(row).queryByRole('button', { name: 'More options' })) row = row.parentElement!
  await userEvent.click(within(row).getByRole('button', { name: 'More options' }))
  // The row offers Leave last, apart from Open work and Copy link.
  expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent).at(-1)).toBe('Leave')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Leave' }))
}
const fieldOf = (event: { tags: string[][] }) => [tagOf(event, 'field'), tagOf(event, 'value')]

describe('Leave on a topic’s row in the Topics column, at the wire (TOPI-7)', () => {
  it('a topic they were added to: sends their leave, member:<me> = false on the topic, signed by them, and says so', async () => {
    relay.seed(root, roster, addedBy(MIKY))
    await leaveFromRow()
    expect(await screen.findByText('Left “Launch”')).toBeInTheDocument()
    const sent = relay.sentOf(1851)
    expect(sent.map(fieldOf)).toEqual([[`member:${ME}`, 'false']])
    expect(sent[0].pubkey).toBe(ME)
    expect(tagOf(sent[0], 'a')).toBe(TOPIC)
    expect(tagOf(sent[0], 'h')).toBe(TEAM)
    // Nothing private: they were in it by being added, not by their team's default.
    expect(relay.sentOf(30078)).toHaveLength(0)
    // The column re-reads what they are in, so the row goes.
    expect(held.refreshed).toBe(1)
  })

  it('a space they are in by their team’s default: writes it into their private off list, and nothing public', async () => {
    held.space = true
    relay.seed(root, roster, asSpace, teamsList([]))
    await leaveFromRow()
    expect(await screen.findByText('Left “Launch”')).toBeInTheDocument()
    const lists = relay.sentOf(30078).filter((event) => tagOf(event, 'd') === TEAMS_D_TAG)
    expect(lists).toHaveLength(1)
    expect(parseTeamsBlob(relay.decrypt(lists[0].content))?.off).toEqual([D])
    expect(relay.sentOf(1851)).toHaveLength(0)
  })

  it('a refused leave says nothing changed, and is not said as left', async () => {
    relay.seed(root, roster, addedBy(MIKY))
    relay.refuse({ when: (event) => event.kind === 1851 })
    await leaveFromRow()
    expect((await screen.findAllByText(/^Nothing changed: “Launch” could not be left\./)).length).toBeGreaterThan(0)
    expect(screen.queryByText('Left “Launch”')).toBeNull()
    await waitFor(() => expect(held.refreshed).toBe(0))
  })
})
