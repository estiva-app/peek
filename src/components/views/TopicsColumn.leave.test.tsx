/**
 * Leave on a topic's row in the Topics column (TOPI-7) is offered only where the switch on its page could change: a
 * topic in an archived team is read-only (§3.2), so its row keeps Open work and Copy link and offers no Leave. The
 * column is the real one; which team leads the topic, and whether it is archived, is the teams read, stubbed here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const TOPIC = `30840:${MIKY}:launch`
const topic = { ref: TOPIC, address: TOPIC, kind: 30840, folder: TEAM, slots: { title: { value: 'Launch' } } } as unknown as ForeignObject

const held = vi.hoisted(() => ({ archived: false }))
const teams = vi.hoisted(() => () => [
  { id: '85db5b59-9e49-4ea1-8e93-3d2a2d78c048', name: 'Steer', isMember: false, isFollowing: false, archived: held.archived, company: false, admins: [], members: [], listed: [{ address: `30840:${'a'.repeat(64)}:launch`, space: false }] },
])
const membership = vi.hoisted(() => () => ({
  state: 'known',
  me: 'c'.repeat(64),
  floor: 0,
  changesOf: () => [],
  termsOf: () => ({ member: true, muted: false }),
  isMentioned: () => false,
  isMember: () => true,
  refresh: async () => {},
}))
vi.mock('@/api/internal/membership', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/internal/membership')),
  useMembership: membership,
}))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useTopicsColumn: () => ({ state: { mine: [topic], others: [], archived: [] }, signedOut: false }),
  useListedNews: () => new Map(),
  useFolders: () => ({ folders: [], signedOut: false, reload: async () => {} }),
  useForeignObjects: () => ({ conversations: async () => ({}) }),
  useMembership: membership,
  useTeams: () => ({ teams: teams(), failed: false, reload: async () => {} }),
  usePeekActions: () => ({ markSpace: async () => ({ ok: true }) }),
}))
vi.mock('@/auth/heldSession', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/auth/heldSession')),
  heldToken: () => ({ accessToken: 't', pubkey: ME }),
}))
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({ ready: true, marker: () => undefined, merged: {} }),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('@/api/useChannelStreams', () => ({ useChannelStreams: () => ({ at: 0, streams: {} }), useHeldChannelEvents: () => [] }))
vi.mock('@/api/useTeams', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/useTeams')),
  useTeams: () => ({ teams: teams(), failed: false, reload: async () => {} }),
}))

import { TopicsColumn } from './TopicsColumn'

/** The items of the topic's row menu, as the person opens it. */
async function rowMenu() {
  render(
    <MemoryRouter>
      <TopicsColumn onControl={() => {}} />
    </MemoryRouter>,
  )
  let row = document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`) as HTMLElement
  while (!within(row).queryByRole('button', { name: 'More options' })) row = row.parentElement!
  await userEvent.click(within(row).getByRole('button', { name: 'More options' }))
  return (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
}

beforeEach(() => {
  held.archived = false
  window.localStorage.clear()
})

describe('Leave on a topic’s row in the Topics column (TOPI-7)', () => {
  it('a topic in a live team offers Leave', async () => {
    expect(await rowMenu()).toContain('Leave')
  })

  it('a topic in an archived team offers no Leave, and keeps Copy link', async () => {
    held.archived = true
    const items = await rowMenu()
    expect(items).not.toContain('Leave')
    expect(items).toContain('Copy link')
  })
})
