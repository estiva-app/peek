/**
 * Archiving a file, at the wire (FOL-46): the person opens Archive on a file,
 * reads what it hides in Peek's words, types a resolution and archives, in the
 * real dialog `useFileControls` draws, and the change is read off the fake
 * relay. The question itself is the kit's `ArchiveDialog` (C11), tested in the
 * kit; this checks Peek's wiring of it: Peek's words, and what is sent.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeNaddr, type SignedEvent } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'
import { useForeignObjects } from '@/api'
import { useFileControls } from '@/components/views/useFileControls'
import { ToastProvider } from '@/lib/toast'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))
// `useFileControls` holds Peek's actions (TOPI-7's Leave), which read the Open work and Screener stores: none here.
vi.mock('@/api/internal/openWork', () => ({ useOpenWork: () => ({}), useOpenWorkIfMounted: () => null }))
vi.mock('@/api/internal/screener', () => ({ useScreener: () => ({}) }))

const RELAY_KEY = 'b'.repeat(64)
const HQ = '11111111-1111-4111-8111-111111111111'
const BARE_FILE = 30840
const D = '4f9d2c1e-7b3a-4e5f-9a1b-2c3d4e5f6a7b'
const ADDRESS = `${BARE_FILE}:${ME}:${D}`
const NADDR = encodeNaddr({ kind: BARE_FILE, pubkey: ME, identifier: D, relays: [] })

const folder = (id: string, name: string, files: string[]): SignedEvent[] => [
  signed({ kind: 39000, created_at: 1_700_000_000, tags: [['d', id], ['name', name]] }, RELAY_KEY),
  signed({ kind: 30890, created_at: 1_700_000_000, tags: [['d', id], ...files.map((a) => ['a', a])] }, RELAY_KEY),
]
const brief = signed({ kind: BARE_FILE, tags: [['d', D], ['title', 'Brief'], ['h', HQ]] })

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  relay.seed(brief, ...folder(HQ, 'HQ', [ADDRESS]))
})
afterAll(() => vi.unstubAllGlobals())

async function resolved(): Promise<ForeignObject> {
  const { result } = renderHook(() => useForeignObjects())
  const file = await result.current.resolveObject(NADDR)
  if (!file) throw new Error('the file did not resolve')
  return file
}

/** Open Archive on the file; resolves once the question is up. */
async function openArchive() {
  const file = await resolved()
  function Page() {
    const controls = useFileControls({})
    return (
      <>
        <button onClick={() => controls.open('archive', file)}>Archive…</button>
        {controls.dialogs}
      </>
    )
  }
  render(
    <ToastProvider>
      <Page />
    </ToastProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Archive…' }))
  return screen.findByRole('dialog')
}

describe('archiving a file at the wire', () => {
  it('asks in Peek’s words, then sends the archive with the resolution typed', async () => {
    const dialog = await openArchive()

    expect(dialog.textContent).toContain('from every list, in Peek and in Ship.')
    expect(dialog.textContent).toContain('Nothing is deleted: it waits under Archive, where Unarchive brings everything back as it was.')
    await userEvent.type(screen.getByLabelText('Resolution (optional)'), '  Shipped in 0.37.  ')
    await userEvent.click(screen.getByRole('button', { name: /^Archive / }))

    // The manifest's archive change, signed by the person, the resolution trimmed as its content.
    await waitFor(() => expect(relay.sentOf(1851)).toHaveLength(1))
    const [change] = relay.sentOf(1851)
    expect(change.pubkey).toBe(ME)
    expect(tagOf(change, 'a')).toBe(ADDRESS)
    expect(tagOf(change, 'field')).toBe('archived')
    expect(tagOf(change, 'value')).toBe('true')
    expect(change.content).toBe('Shipped in 0.37.')
  })
})
