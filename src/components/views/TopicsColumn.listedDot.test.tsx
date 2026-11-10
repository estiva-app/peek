/**
 * A topic's row in the Topics column lights for news on a file it lists when you follow the topic at All, and not at
 * Important (TOPI-3): at All the topic's middle column draws those files' threads, so its dot says when one has news.
 * The news is what the column's own read holds (`useListedNews`), stubbed here; the dot is the real
 * `useConversationBadges` over the shared place rule, with the topic's own conversation read as empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { buildLevelChange, buildMembershipChange } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const TOPIC = `30840:${MIKY}:launch`
const ISSUE = `30851:${MIKY}:issue-12`
const NOW = Math.floor(Date.now() / 1000)
const topic = { ref: TOPIC, address: TOPIC, kind: 30840, folder: TEAM, slots: { title: { value: 'Launch' } } } as unknown as ForeignObject

const follows = vi.hoisted(() => ({ changes: [] as SignedEvent[] }))
const news = vi.hoisted(() => ({ value: new Map<string, readonly { file: string; events: readonly unknown[] }[]>() }))

// What the relay says you are in, with your changes on the topic: the badges read it inside `@/api`, past its mock.
const membership = vi.hoisted(() => () => ({
  state: 'known',
  me: ME,
  floor: NOW - 90 * 24 * 60 * 60,
  changesOf: (address: string) => (address === TOPIC ? follows.changes : []),
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
  useListedNews: () => news.value,
  useFolders: () => ({ folders: [], signedOut: false, reload: async () => {} }),
  // The topic's own conversation holds nothing: only a listed file's news can light it.
  useForeignObjects: () => ({ conversations: async () => ({ [TOPIC]: [] }) }),
  useMembership: membership,
  // No team is held: the row offers no Make it a space (TOPI-7).
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
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
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
}))

import { TopicsColumn } from './TopicsColumn'

const added = signed({ ...buildMembershipChange(MIKY, (NOW - 3600) * 1000, { file: TOPIC, folder: TEAM, person: ME, member: true }), created_at: NOW - 3600 }, MIKY)
const chose = (value: 'all' | 'important') => signed({ ...buildLevelChange(ME, (NOW - 1800) * 1000, { place: TOPIC, folder: TEAM, level: value }), created_at: NOW - 1800 }, ME)
const onIssue = signed({ kind: 1111, created_at: NOW - 60, content: 'Blocked on review', tags: [['A', ISSUE], ['K', '30851'], ['a', ISSUE], ['k', '30851'], ['h', 'ship-team']] }, MIKY)

const dotOf = () => !!document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`)?.parentElement?.querySelector('[data-unread]')
const mount = () =>
  render(
    <MemoryRouter>
      <TopicsColumn />
    </MemoryRouter>,
  )

beforeEach(() => {
  news.value = new Map([[TOPIC, [{ file: ISSUE, events: [onIssue] }]]])
})

describe("a topic's row lights for news on a file it lists, at All only (TOPI-3)", () => {
  it('at All a new comment on the issue the topic lists lights the row; at Important it does not', async () => {
    follows.changes = [added, chose('all')]
    const atAll = mount()
    await waitFor(() => expect(dotOf()).toBe(true))
    atAll.unmount()

    follows.changes = [added, chose('important')]
    const atImportant = mount()
    await atImportant.findByText('Launch')
    // The listed news is judged on every draw, with no read to wait for: the same news, at Important, stays dark.
    expect(dotOf()).toBe(false)
  })
})
