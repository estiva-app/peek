/**
 * Urgent is the DM dots' urgent flag, listed (CON-14).
 *
 * `desk.urgentList` walked every DM's messages and replies on the server. The
 * sidebar's indicator already made the same judgement on the device, so Urgent
 * is that judgement — a DM is in Urgent exactly when its row shows the
 * indicator — and Convex is not asked.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))

const URGENT = 'a'.repeat(64)
const CALM = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
vi.mock('@/api/internal/dms', () => ({ useDmChannels: () => ({ partners: [URGENT, CALM, STRANGER] }) }))
vi.mock('@/api/unread', () => ({
  useUnread: () => ({ dmHasUnread: () => true, dmIsUrgent: (id: string) => id !== CALM }),
}))
vi.mock('@/api/people', () => ({
  useWorkspacePeople: () => [
    { id: URGENT, name: 'Hallie Pratt', avatarSrc: 'hallie.png' },
    { id: CALM, name: 'Greg Bothman' },
  ],
}))
vi.mock('@/api/internal/openWork', () => ({ useOpenWork: () => ({ items: [], isLoading: false }) }))
const URGENT_FILE = `30840:${'f'.repeat(64)}:spec`
let urgentFiles: { address: string; kind: number; title: string; at: number }[] = []
vi.mock('@/api/internal/screener', () => ({ useScreener: () => ({ items: [], isLoading: false, urgentFiles }) }))

describe('useDeskItems().urgent', () => {
  it('lists the DMs whose indicator is lit, named from the roster', async () => {
    urgentFiles = []
    const { useDeskItems } = await import('./desk')
    const { result } = renderHook(() => useDeskItems())
    expect(result.current.urgent).toEqual([
      { id: `urg_dm_${URGENT}`, kind: 'dm', dmId: URGENT, name: 'Hallie Pratt', avatarSrc: 'hallie.png' },
    ])
  })

  it('lists the files with an unread urgent comment after the DMs (CON-17)', async () => {
    urgentFiles = [{ address: URGENT_FILE, kind: 30840, title: 'The spec', at: 1 }]
    const { useDeskItems } = await import('./desk')
    const { result } = renderHook(() => useDeskItems())
    expect(result.current.urgent.map((item) => item.id)).toEqual([`urg_dm_${URGENT}`, `urg_file_${URGENT_FILE}`])
    expect(result.current.urgent[1]).toEqual({
      id: `urg_file_${URGENT_FILE}`,
      kind: 'file',
      address: URGENT_FILE,
      fileKind: 30840,
      title: 'The spec',
    })
  })
})
