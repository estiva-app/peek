/**
 * Leave on a topic's row in the Topics column, at the wire (TOPI-7): the person opens the row's menu and picks Leave,
 * and what reaches the relay is what the topic page's switch sends for Not following — the place read first, then
 * their leave, or the space written into their private off list. The row, `useFileControls` and `usePeekActions`
 * are the real ones; the fake relay stops at `fetch`, and the toast is the real one the person reads.
 */
import { useSyncExternalStore } from 'react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { buildMembershipChange, parseTeamsBlob, serializeTeamsBlob, switchStateOf, TEAMS_D_TAG } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'
import { topicFollowTarget, useMembership, usePlaceFollow, type Team } from '@/api'
import { storedToken } from '@/auth/estivaId'
import { readPlaceAsViewer } from '@/nostr/places'
import { useFileControls } from '@/components/views/useFileControls'
import { usePlaceFollowControls } from '@/components/PlaceFollow'
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

/**
 * The teams this tab holds: the topic's team, which the person is in, leading it as a topic or as a space — or
 * archived. And whether the topic is the person's, as the membership read last found it on the relay.
 */
const held = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  return {
    space: false,
    teamArchived: false,
    inTopic: true,
    // Every read that lands draws again, as a held read does.
    version: 0,
    subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    set(inTopic: boolean) {
      this.inTopic = inTopic
      this.version++
      listeners.forEach((listener) => listener())
    },
  }
})
const teams = () => [
  {
    id: TEAM,
    name: 'Steer',
    isMember: true,
    isFollowing: false,
    archived: held.teamArchived,
    company: false,
    admins: [],
    members: [],
    listed: [{ address: TOPIC, space: held.space }],
  },
]
/**
 * What the relay says the person is in, as the column, the row and Leave read it. `refresh` reads the topic from the
 * relay as the person, as the real membership read does: a leave the relay holds takes the topic out of their list.
 */
const membership = (inTopic: boolean) => ({
  state: 'known',
  me: ME,
  isMember: () => inTopic,
  termsOf: () => ({ member: inTopic, muted: false }),
  changesOf: () => [],
  isMentioned: () => false,
  refresh: async () => {
    const place = { address: TOPIC, team: TEAM }
    const read = await readPlaceAsViewer(place, 'https://relay.test', storedToken()!)
    held.set(switchStateOf(place, ME, read.facts).shown !== 'not-following')
  },
  setMember: async () => true,
})
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useTeams: () => ({ teams: teams(), failed: false, reload: async () => {} }),
  useMembership: () => (useSyncExternalStore(held.subscribe, () => held.version), membership(held.inTopic)),
}))
// The page's switch reads the same membership, from inside the seam.
vi.mock('@/api/internal/membership', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/internal/membership')),
  useMembership: () => (useSyncExternalStore(held.subscribe, () => held.version), membership(held.inTopic)),
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
  held.teamArchived = false
  held.inTopic = true
})
afterAll(() => vi.unstubAllGlobals())

/** The Topics column, listing the topic while the person is in it, beside the topic's own page with its follow switch. */
function Topics() {
  const controls = useFileControls()
  const { isMember } = useMembership()
  const target = topicFollowTarget(topic, teams() as unknown as Team[], false)
  const follow = usePlaceFollowControls({ follow: usePlaceFollow(target), target, title: 'Launch', me: ME, directory: undefined })
  return (
    <>
      <TopicsColumnView state={{ mine: isMember(TOPIC) ? [topic] : [], others: [], archived: [] }} onControl={controls.open} />
      <div data-testid="page">{follow.switcher}</div>
      {controls.dialogs}
    </>
  )
}
/** What the open page's switch says: its accessible name names the level. */
const switchLabel = () => within(screen.getByTestId('page')).getByRole('button', { name: /change how you follow Launch/ }).getAttribute('aria-label')
const rowOf = () => document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`)

/** Draw the column and the page, and open the topic's row menu; the items it offers. */
async function openRowMenu() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <Topics />
      </ToastProvider>
    </MemoryRouter>,
  )
  let row = rowOf() as HTMLElement
  while (!within(row).queryByRole('button', { name: 'More options' })) row = row.parentElement!
  await userEvent.click(within(row).getByRole('button', { name: 'More options' }))
  return (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
}

/** Open the topic's row menu in the Topics column and pick Leave, as the person does. */
async function leaveFromRow() {
  // The row offers Leave last, apart from Open work and Copy link.
  expect((await openRowMenu()).at(-1)).toBe('Leave')
  await userEvent.click(screen.getByRole('menuitem', { name: 'Leave' }))
}
const fieldOf = (event: { tags: string[][] }) => [tagOf(event, 'field'), tagOf(event, 'value')]

describe('Leave on a topic’s row in the Topics column, at the wire (TOPI-7)', () => {
  it('a topic they were added to: sends their leave, member:<me> = false on the topic, signed by them, and says so', async () => {
    relay.seed(root, roster, addedBy(MIKY))
    await openRowMenu()
    // The topic's page, open beside the column, shows them following it.
    await waitFor(() => expect(switchLabel()).toMatch(/at Important/))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leave' }))
    expect(await screen.findByText('Left “Launch”')).toBeInTheDocument()
    const sent = relay.sentOf(1851)
    expect(sent.map(fieldOf)).toEqual([[`member:${ME}`, 'false']])
    expect(sent[0].pubkey).toBe(ME)
    expect(tagOf(sent[0], 'a')).toBe(TOPIC)
    expect(tagOf(sent[0], 'h')).toBe(TEAM)
    // Nothing private: they were in it by being added, not by their team's default.
    expect(relay.sentOf(30078)).toHaveLength(0)
    // The column re-reads what they are in, so the row goes; and the page's switch re-reads, so it says Not following.
    expect(rowOf()).toBeNull()
    await waitFor(() => expect(switchLabel()).not.toMatch(/at (Important|All)/))
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
    await openRowMenu()
    await waitFor(() => expect(switchLabel()).toMatch(/at Important/))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leave' }))
    // Said once the relay answered, so everything the leave does has run by now.
    expect((await screen.findAllByText(/^“Launch” could not be left\. Nothing changed\./)).length).toBeGreaterThan(0)
    expect(screen.queryByText('Left “Launch”')).toBeNull()
    // The topic is still theirs: its row stays in the column, and the page still says they follow it.
    expect(rowOf()).not.toBeNull()
    expect(switchLabel()).toMatch(/at Important/)
  })

  it('a Leave picked after its team was archived says it cannot be left, and sends nothing', async () => {
    relay.seed(root, roster, addedBy(MIKY))
    await openRowMenu()
    // The team is archived while the menu is open: the teams read lands again.
    act(() => {
      held.teamArchived = true
      held.set(true)
    })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Leave' }))
    // Whatever the toast says, it is said once Leave has run.
    const said = (await screen.findAllByText(/“Launch”/)).map((toast) => toast.textContent)
    expect(said).toContain('“Launch” is in an archived team, so it cannot be left.')
    expect(said).not.toContain('Left “Launch”')
    expect(relay.sentOf(1851, 30078)).toHaveLength(0)
  })
})
