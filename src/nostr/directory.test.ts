/**
 * The workspace directory reads profiles the protocol's way (CON-5): NIP-24's
 * `bot` has to arrive, because it is what offers Edit and Delete on an agent's
 * message (SPEC §6.5), and a profile that will not parse is still skipped.
 */
import { describe, expect, it, vi } from 'vitest'

const { queryRelay } = vi.hoisted(() => ({ queryRelay: vi.fn() }))
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { directoryAsViewer } from './foreign'

const token = { accessToken: 't', pubkey: 'a'.repeat(64) } as never
const profile = (pubkey: string, content: string) => ({ id: pubkey, pubkey, kind: 0, created_at: 1, tags: [], content, sig: '' })

describe('directoryAsViewer', () => {
  it("carries an agent's bot flag, names people, and skips a profile that will not parse", async () => {
    const HUMAN = 'b'.repeat(64)
    const AGENT = 'c'.repeat(64)
    const BROKEN = 'd'.repeat(64)
    queryRelay.mockResolvedValue({
      ok: true,
      events: [
        profile(HUMAN, JSON.stringify({ name: 'cath', display_name: 'Cath', picture: 'https://p/cath.png' })),
        profile(AGENT, JSON.stringify({ name: 'helper', bot: true })),
        profile(BROKEN, '{not json'),
      ],
    })
    const people = await directoryAsViewer('https://relay.test', token)
    expect(people[HUMAN]).toEqual({ displayName: 'Cath', picture: 'https://p/cath.png' })
    expect(people[AGENT]).toMatchObject({ displayName: 'helper', bot: true })
    expect(BROKEN in people).toBe(false)
  })
})
