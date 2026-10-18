/**
 * Moving a file between Folders, at the wire (UNI-7): the person opens Move
 * on a file, picks a Folder and clicks Move, in the real dialog that
 * `useFileControls` draws, and the `kind:1852` commands are read off the fake
 * relay. The planner's own tests (`src/nostr/folderManagement.test.ts`) check
 * `moveFileAsViewer` with the bridge mocked; these check that the control
 * reads the Folders from the relay, sends add-then-remove for what the person
 * picked, and stops where a refusal says to.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeNaddr, type SignedEvent } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { installWireRelay, ME, signed, tagOf, tagsOf, type WireRelay } from '@/test/wireRelay'
import { useForeignObjects } from '@/api'
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

/** Open Move on the file, pick `to`, click Move; resolves once the dialog has answered. */
async function moveTo(to: string, onMoved = vi.fn()) {
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
  await userEvent.click(screen.getByRole('button', { name: 'Move' }))
  return onMoved
}

const commands = () => relay.sentOf(1852).map((event) => `${tagOf(event, 'op')} ${tagOf(event, 'h') === HQ ? 'HQ' : tagOf(event, 'h') === STEER ? 'Steer' : tagOf(event, 'h')}`)

describe('moving a file at the wire', () => {
  it('Move sends an add to the picked Folder, then a remove from the one listing it, both naming the file', async () => {
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['add Steer', 'remove HQ'])
    for (const event of relay.sentOf(1852)) {
      expect(event.pubkey).toBe(ME)
      expect(tagsOf(event, 'a')).toEqual([ADDRESS])
    }
    // The file's own record is not rewritten: its conversation keeps its Folder.
    expect(relay.sent.filter((event) => event.kind !== 1852)).toEqual([])
  })

  it('a topic started under the file moves with it, in the same two commands', async () => {
    const SUB_D = '5a0e3d2f-8c4b-4f60-8b2c-3d4e5f6a7b8c'
    const SUB = `${BARE_FILE}:${ME}:${SUB_D}`
    relay.seed(
      signed({ kind: BARE_FILE, tags: [['d', SUB_D], ['title', 'Notes'], ['h', HQ], ['a', ADDRESS]] }),
      ...folder(HQ, 'HQ', [ADDRESS, SUB], 1_700_000_001),
    )
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['add Steer', 'remove HQ'])
    for (const event of relay.sentOf(1852)) expect(tagsOf(event, 'a').sort()).toEqual([ADDRESS, SUB].sort())
  })

  it('a refused add sends no remove, so the file is never in no Folder', async () => {
    relay.refuse({ when: (event) => event.kind === 1852 && tagOf(event, 'op') === 'add', message: 'restricted: not a channel member' })
    const onMoved = await moveTo('Steer')

    expect(await screen.findByText(/not a channel member/)).toBeInTheDocument()
    expect(commands()).toEqual(['add Steer'])
    expect(onMoved).not.toHaveBeenCalled()
  })

  it('a refused remove after an accepted add counts as moved, and names the Folder that still lists it', async () => {
    relay.refuse({ when: (event) => event.kind === 1852 && tagOf(event, 'op') === 'remove' })
    const onMoved = await moveTo('Steer')

    await waitFor(() => expect(onMoved).toHaveBeenCalled())
    expect(commands()).toEqual(['add Steer', 'remove HQ'])
    expect(await screen.findByText(/Moved to Steer, but HQ still lists it too/)).toBeInTheDocument()
  })
})
