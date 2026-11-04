/**
 * Moving a file between Folders, at the wire (UNI-7): the person opens Move
 * on a file, picks a Folder and clicks Move, in the real dialog that
 * `useFileControls` draws, and the `kind:1852` commands are read off the fake
 * relay. The planner's own tests (`src/nostr/folderManagement.test.ts`) check
 * `moveFileAsViewer` with the bridge mocked; these check that the control
 * reads the Folders from the relay, sends one `move` per Folder that lists the
 * file, and stops where a refusal says to, in Peek's words, never the relay's.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeNaddr, type SignedEvent } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { installWireRelay, ME, signed, tagOf, tagsOf, type WireRelay } from '@/test/wireRelay'
import { useForeignObjects } from '@/api'
import { resetTeamsForTests } from '@/api/useTeams'
import { useFileControls } from '@/components/views/useFileControls'
import { ToastProvider } from '@/lib/toast'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))

const RELAY_KEY = 'b'.repeat(64)
const HQ = '11111111-1111-4111-8111-111111111111'
const STEER = '22222222-2222-4222-8222-222222222222'
const BARE_FILE = 30840
const D = '4f9d2c1e-7b3a-4e5f-9a1b-2c3d4e5f6a7b'
const ADDRESS = `${BARE_FILE}:${ME}:${D}`
const NADDR = encodeNaddr({ kind: BARE_FILE, pubkey: ME, identifier: D, relays: [] })

/** A Folder's name and its state listing `files`; a later `at` replaces an earlier state. */
const folder = (id: string, name: string, files: string[], at = 1_700_000_000): SignedEvent[] => [
  signed({ kind: 39000, created_at: at, tags: [['d', id], ['name', name]] }, RELAY_KEY),
  signed({ kind: 30890, created_at: at, tags: [['d', id], ...files.map((a) => ['a', a])] }, RELAY_KEY),
]
const brief = signed({ kind: BARE_FILE, tags: [['d', D], ['title', 'Brief'], ['h', HQ]] })

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  relay.seed(brief, ...folder(HQ, 'HQ', [ADDRESS]), ...folder(STEER, 'Steer', []))
})
afterAll(() => vi.unstubAllGlobals())

/** The file as its page has it: resolved from the relay. */
async function resolved(): Promise<ForeignObject> {
  const { result } = renderHook(() => useForeignObjects())
  const file = await result.current.resolveObject(NADDR)
  if (!file) throw new Error('the file did not resolve')
  return file
}

/** Open Move on the file and pick `to`, Move not pressed yet. */
async function pick(to: string, onMoved = vi.fn()) {
  const file = await resolved()
  function Page() {
    const controls = useFileControls({ onMoved })
    return (
      <>
        <button onClick={() => controls.open('move', file)}>Move…</button>
        {controls.dialogs}
      </>
    )
  }
  render(
    <ToastProvider>
      <Page />
    </ToastProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Move…' }))
  await userEvent.click(await screen.findByRole('combobox', { name: 'Folder' }))
  await userEvent.click(await screen.findByRole('option', { name: to }))
  return onMoved
}

/** Open Move on the file, pick `to`, click Move; resolves once the dialog has answered. */
async function moveTo(to: string, onMoved = vi.fn()) {
  await pick(to, onMoved)
  await userEvent.click(screen.getByRole('button', { name: 'Move' }))
  return onMoved
}

/** What the toast says, once one is up: every toast here offers Dismiss. */
async function said(): Promise<string | null | undefined> {
  const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
  return dismiss.parentElement?.parentElement?.textContent?.replace(/Dismiss$/, '')
}

const OPS = '33333333-3333-4333-8333-333333333333'
const nameOf = (id: string | undefined) => (id === HQ ? 'HQ' : id === STEER ? 'Steer' : id === OPS ? 'Ops' : id)
const commands = () => relay.sentOf(1852).map((event) => `${tagOf(event, 'op')} ${nameOf(tagOf(event, 'from'))}→${nameOf(tagOf(event, 'h'))}`)

describe('moving a file at the wire', () => {
  it('Move sends one move from the Folder listing it to the picked one, naming the file', async () => {
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['move HQ→Steer'])
    for (const event of relay.sentOf(1852)) {
      expect(event.pubkey).toBe(ME)
      expect(tagsOf(event, 'a')).toEqual([ADDRESS])
    }
    // The file's own record is not rewritten: its conversation keeps its Folder.
    expect(relay.sent.filter((event) => event.kind !== 1852)).toEqual([])
  })

  it('a topic started under the file moves with it, in the same move', async () => {
    const SUB_D = '5a0e3d2f-8c4b-4f60-8b2c-3d4e5f6a7b8c'
    const SUB = `${BARE_FILE}:${ME}:${SUB_D}`
    relay.seed(
      signed({ kind: BARE_FILE, tags: [['d', SUB_D], ['title', 'Notes'], ['h', HQ], ['a', ADDRESS]] }),
      ...folder(HQ, 'HQ', [ADDRESS, SUB], 1_700_000_001),
    )
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['move HQ→Steer'])
    for (const event of relay.sentOf(1852)) expect(tagsOf(event, 'a').sort()).toEqual([ADDRESS, SUB].sort())
  })

  it('a refused move says why in Peek’s words, not the relay’s, and counts as not moved', async () => {
    relay.refuse({ when: (event) => event.kind === 1852, message: "invalid: only the team's members mark or unmark its spaces" })
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(commands()).toEqual(['move HQ→Steer']))
    expect(await said()).toBe('Nothing was moved: you need to be a member of both teams to move this.')
    expect(onMoved).not.toHaveBeenCalled()
  })

  it('a file two Folders list takes a move from each; a refused second one counts as moved and says which Folder still lists it and why', async () => {
    relay.seed(...folder(OPS, 'Ops', [ADDRESS]))
    relay.refuse({ when: (event) => event.kind === 1852 && tagOf(event, 'from') === OPS, message: 'invalid: team 33333333 is archived; its list does not change' })
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['move HQ→Steer', 'move Ops→Steer'])
    expect(await said()).toBe('Moved to Steer, but Ops still lists it too: one of the teams is archived.')
  })

  it('after "the Folders changed", Move pressed again moves it from where it is now', async () => {
    const onMoved = await pick('Steer')
    // Meanwhile somebody moved it from HQ to Ops, so the read the dialog opened on is out of date.
    relay.seed(...folder(HQ, 'HQ', [], 1_700_000_001), ...folder(OPS, 'Ops', [ADDRESS], 1_700_000_001))
    relay.refuse({ when: (event) => event.kind === 1852 && tagOf(event, 'from') === HQ, message: `invalid: the team a move leaves does not list ${ADDRESS}` })
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))

    expect(await said()).toBe('Nothing was moved: the teams changed since you opened this. Try again.')
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['move HQ→Steer', 'move Ops→Steer'])
  })
})

/*
  A space's mark (TEA-5, SPEC §3.3): moving one of HQ's spaces into a team the
  mover is in asks "Keep it a space in Steer", ticked. The tab holds no teams
  until Move opens — as on a topic opened from a link — so they are read then.
*/
describe('moving a space at the wire', () => {
  beforeEach(() => {
    // The teams an earlier case read are module state: this one's are read when Move opens.
    resetTeamsForTests()
    relay.seed(
      signed({ kind: 30890, created_at: 1_700_000_001, tags: [['d', HQ], ['a', ADDRESS, '', 'space']] }, RELAY_KEY),
      signed({ kind: 39002, created_at: 1_700_000_000, tags: [['d', STEER], ['p', ME]] }, RELAY_KEY),
      signed({ kind: 39002, created_at: 1_700_000_000, tags: [['d', HQ], ['p', ME]] }, RELAY_KEY),
    )
  })
  const roleAtTarget = () => relay.sentOf(1852)[0]?.tags.find((t) => t[0] === 'a' && t[1] === ADDRESS)?.[3]

  it('ticked, the move makes it a space of the team it goes to', async () => {
    const onMoved = await pick('Steer')
    expect(screen.getByRole('checkbox', { name: 'Keep it a space in Steer' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['move HQ→Steer'])
    expect(roleAtTarget()).toBe('space')
  })

  it('unticked, it arrives a topic the team leads', async () => {
    const onMoved = await pick('Steer')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Keep it a space in Steer' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(roleAtTarget()).toBeUndefined()
  })
})

/*
  An issue is listed by no Folder: it changes Folder by changing project, and
  what is listed under it follows by a move. The project change landing and the
  move refused is a half-done move, said the way any other is.
*/
describe('moving an issue at the wire', () => {
  const SHIP = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
  const ISSUE = 30851
  const PROJECT = 30850
  const ISSUE_D = '2b9e4c1a-7d3f-4e5a-9b6c-0d1e2f3a4b5c'
  const ISSUE_ADDRESS = `${ISSUE}:${SHIP}:${ISSUE_D}`
  const PROJECT_HQ = `${PROJECT}:${SHIP}:9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f`
  const PROJECT_STEER = `${PROJECT}:${SHIP}:8e7d6c5b-4a3f-4c2d-9e1f-0a9b8c7d6e5f`
  const SUB_D = '5a0e3d2f-8c4b-4f60-8b2c-3d4e5f6a7b8c'
  const SUB = `${BARE_FILE}:${ME}:${SUB_D}`
  const manifest = signed(
    {
      kind: 31990,
      tags: [['d', 'estiva-ship'], ['k', String(PROJECT)], ['k', String(ISSUE)]],
      content: JSON.stringify({
        name: 'Ship',
        records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
        projections: {
          [PROJECT]: {
            widget: 'card',
            noun: 'project',
            slots: { title: { fold: 'name', tag: 'name' }, list: { children: { kind: ISSUE, via: 'a', limit: 200, movedBy: 'project' } } },
          },
          [ISSUE]: { widget: 'row', noun: 'issue', slots: { title: { fold: 'title', tag: 'title' } } },
        },
        actions: [{ id: 'move-issue', label: 'Move to project', appliesTo: String(ISSUE), emits: { kind: 1851, field: 'project' }, input: { type: 'string' } }],
      }),
    },
    SHIP,
  )
  const project = (address: string, name: string, h: string) => signed({ kind: PROJECT, tags: [['d', address.split(':')[2]!], ['name', name], ['h', h]] }, SHIP)

  beforeEach(() => {
    relay.reset()
    relay.seed(
      manifest,
      project(PROJECT_HQ, 'Widgets', HQ),
      project(PROJECT_STEER, 'Gadgets', STEER),
      signed({ kind: ISSUE, tags: [['d', ISSUE_D], ['title', 'Card holds its pick'], ['a', PROJECT_HQ], ['h', HQ]] }, SHIP),
      // A topic started under the issue, listed by HQ beside the issue's project.
      signed({ kind: BARE_FILE, tags: [['d', SUB_D], ['title', 'Notes'], ['h', HQ], ['a', ISSUE_ADDRESS]] }),
      ...folder(HQ, 'HQ', [PROJECT_HQ, SUB]),
      ...folder(STEER, 'Steer', [PROJECT_STEER]),
    )
  })

  it('the issue takes its new project and the move under it is refused: it says the issue moved, which Folder still lists it and why', async () => {
    relay.refuse({ when: (event) => event.kind === 1852, message: "invalid: only the team's members mark or unmark its spaces" })
    const { result } = renderHook(() => useForeignObjects())
    const issue = await result.current.resolveObject(encodeNaddr({ kind: ISSUE, pubkey: SHIP, identifier: ISSUE_D, relays: [] }))
    if (!issue) throw new Error('the issue did not resolve')
    const onMoved = vi.fn()
    function Page() {
      const controls = useFileControls({ onMoved })
      return (
        <>
          <button onClick={() => controls.open('move', issue!)}>Move…</button>
          {controls.dialogs}
        </>
      )
    }
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Move…' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Folder' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Steer' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Put it under' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Gadgets' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(relay.sentOf(1851).map((event) => [tagOf(event, 'field'), tagOf(event, 'value')])).toEqual([['project', PROJECT_STEER]])
    expect(commands()).toEqual(['move HQ→Steer'])
    expect(await said()).toBe('Moved to Steer, but HQ still lists it too: you need to be a member of both teams to move this.')
  })
})
