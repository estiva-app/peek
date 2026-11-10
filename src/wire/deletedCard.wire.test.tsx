/**
 * A deleted project's card under a message, at the wire (ALO-6, SPEC §6.5). Ship deletes a project by setting its
 * `deleted` field to `true`; the project keeps its record and stays listed, and every reader hides it from lists. A
 * card to it still draws: its title, who deleted it and when, and Restore for someone who may change it, which sets
 * `deleted` back to the empty value (the story `Project changes`, Peek's card).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { encodeNaddr } from '@estiva-app/protocol'
import { installWireRelay, ME, signed, tagOf, type WireRelay } from '@/test/wireRelay'
import { MessageCard } from '@/components/ui/MessageLinks'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))

const SHIP = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const OTHER = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '05bebd5b-1b6e-4f47-9d3e-6b7a1c2d3e4f'
const PROJECT = 30850
const D = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'
const ADDRESS = `${PROJECT}:${SHIP}:${D}`
const NADDR = encodeNaddr({ kind: PROJECT, pubkey: SHIP, identifier: D, relays: [] })

/** Ship's manifest with Delete declared as a change of `deleted`: `true` deletes, the empty value restores. */
const manifest = signed(
  {
    kind: 31990,
    tags: [['d', 'estiva-ship'], ['k', String(PROJECT)]],
    content: JSON.stringify({
      name: 'Ship',
      records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
      vocabularies: {
        deleted: [
          { value: '', label: 'Restored' },
          { value: 'true', label: 'Deleted' },
        ],
      },
      projections: { [PROJECT]: { widget: 'card', noun: 'project', slots: { title: { fold: 'name', tag: 'name' } } } },
      actions: [
        {
          id: 'delete-project',
          label: 'Delete',
          effect: 'destructive',
          appliesTo: String(PROJECT),
          emits: { kind: 1851, field: 'deleted' },
          input: { type: 'string', enum: 'deleted' },
        },
      ],
    }),
  },
  SHIP,
)
const project = signed({ kind: PROJECT, created_at: 1_700_000_000, tags: [['d', D], ['name', 'Widgets 2'], ['h', FOLDER]] }, SHIP)
const deleting = signed(
  { kind: 1851, created_at: 1_762_250_000, tags: [['a', ADDRESS], ['O', D], ['field', 'deleted'], ['value', 'true'], ['h', FOLDER]] },
  OTHER,
)
const whoDeleted = signed({ kind: 0, created_at: 1_700_000_000, content: JSON.stringify({ name: 'Person Two' }) }, OTHER)

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
  relay.seed(manifest, project, deleting, whoDeleted)
})
afterAll(() => vi.unstubAllGlobals())

describe("a deleted project's card under a message", () => {
  it('says who deleted it, and Restore sets deleted back to the empty value', async () => {
    render(<MessageCard uri={`nostr:${NADDR}`} />)

    expect(await screen.findByText('Widgets 2')).toBeInTheDocument()
    expect(screen.getByText(/^Deleted by Person Two · /)).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => expect(relay.sentOf(1851)).toHaveLength(1))
    const [restored] = relay.sentOf(1851)
    expect(restored.pubkey).toBe(ME)
    expect([tagOf(restored, 'a'), tagOf(restored, 'field'), tagOf(restored, 'value')]).toEqual([ADDRESS, 'deleted', ''])
  })
})
