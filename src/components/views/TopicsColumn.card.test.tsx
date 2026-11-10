/**
 * Resting on a lit topic in the Topics column shows what is new there (ACT-3): who, what, on which file, the words
 * and when, newest first; a click opens it where it was said; more than five ends with "N more". A row with nothing
 * new has no dot and no card. The news is the column's own read (`useListedNews`), stubbed here; the dot and the
 * card are the real `useConversationBadges` over the shared rule, with the topic's own conversation read as empty.
 * Real timers, as the kit's PreviewCard test: Base UI's hover card does not open under fake timers in jsdom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { buildLevelChange, buildMembershipChange } from '@estiva-app/conversation'
import type { ForeignObject } from '@estiva-app/interop'
import type { SignedEvent } from '@estiva-app/protocol'
import { signed } from '@/test/wireRelay'

const ME = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const KATERINA = 'b'.repeat(64)
const TEAM = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'
const TOPIC = `30840:${MIKY}:launch`
const ISSUE = `30851:${MIKY}:issue-12`
const NOW = Math.floor(Date.now() / 1000)
const topic = { ref: TOPIC, address: TOPIC, kind: 30840, folder: TEAM, slots: { title: { value: 'Launch' } } } as unknown as ForeignObject

const follows = vi.hoisted(() => ({ changes: [] as SignedEvent[] }))
const news = vi.hoisted(() => ({ value: new Map<string, readonly { file: string; events: readonly unknown[] }[]>() }))

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
  useForeignObjects: () => ({ conversations: async () => ({ [TOPIC]: [] }) }),
  useMembership: membership,
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
  usePeekActions: () => ({ markSpace: async () => ({ ok: true }) }),
  useMentionNames: () => [
    { pubkey: MIKY, name: 'Miky' },
    { pubkey: KATERINA, name: 'Katerina' },
  ],
}))
// The listed issue's title, as the card's one read on opening answers it.
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useResolvedReferences: (refs: readonly string[]) =>
    Object.fromEntries(refs.map((ref) => [ref, ref === ISSUE ? { slots: { title: { value: 'Sign-in keeps failing' } } } : null])),
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

import { PeekSetup } from '@/lib/PeekSetup'
import { TopicsColumn } from './TopicsColumn'

const added = signed({ ...buildMembershipChange(MIKY, (NOW - 3600) * 1000, { file: TOPIC, folder: TEAM, person: ME, member: true }), created_at: NOW - 3600 }, MIKY)
const chose = (value: 'all' | 'important') => signed({ ...buildLevelChange(ME, (NOW - 1800) * 1000, { place: TOPIC, folder: TEAM, level: value }), created_at: NOW - 1800 }, ME)
const comment = (by: string, ago: number, content: string) =>
  signed({ kind: 1111, created_at: NOW - ago, content, tags: [['A', ISSUE], ['K', '30851'], ['a', ISSUE], ['k', '30851'], ['h', 'ship-team']] }, by)

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/app/topics']}>
      {/* The kit's links go through Peek's router, as in the app. */}
      <PeekSetup>
        <TopicsColumn />
        <Where />
      </PeekSetup>
    </MemoryRouter>,
  )
const dotOf = () => !!document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`)?.parentElement?.querySelector('[data-unread]')

describe('resting on a lit topic shows what is new there (ACT-3)', () => {
  beforeEach(() => {
    follows.changes = [added, chose('all')]
  })

  it('names who wrote on which listed file, with the words, newest first; a click opens the file at that comment', async () => {
    const older = comment(MIKY, 600, 'Looking at it now')
    const newer = comment(KATERINA, 60, 'Blocked on review')
    news.value = new Map([[TOPIC, [{ file: ISSUE, events: [older, newer] }]]])
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(dotOf()).toBe(true))
    await user.hover(screen.getByText('Launch'))
    const first = await screen.findByText(/Blocked on review/)
    expect(first.textContent).toContain('Sign-in keeps failing')
    const lines = screen.getAllByText(/started a conversation/)
    expect(lines).toHaveLength(2)
    // Newest first: Katerina's line comes before Miky's.
    const text = first.closest('[data-side]')?.textContent ?? ''
    expect(text.indexOf('Katerina')).toBeLessThan(text.indexOf('Miky'))
    await user.click(first)
    expect(screen.getByTestId('where').textContent).toBe(`/topic/${ISSUE}?thread=${newer.id}`)
  })

  it('a row with nothing new has no dot and opens no card', async () => {
    follows.changes = [added, chose('important')]
    news.value = new Map([[TOPIC, [{ file: ISSUE, events: [comment(KATERINA, 60, 'Blocked on review')] }]]])
    const user = userEvent.setup()
    mount()
    await screen.findByText('Launch')
    expect(dotOf()).toBe(false)
    await user.hover(screen.getByText('Launch'))
    // Past the card's 350ms: nothing opens.
    await expect(screen.findByText(/Blocked on review/, {}, { timeout: 700 })).rejects.toThrow()
  })

  it('more than five new things end with "N more", which opens the topic', async () => {
    news.value = new Map([[TOPIC, [{ file: ISSUE, events: [1, 2, 3, 4, 5, 6].map((n) => comment(KATERINA, 60 * n, `Note ${n}`)) }]]])
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(dotOf()).toBe(true))
    await user.hover(screen.getByText('Launch'))
    const more = await screen.findByRole('button', { name: '1 more' })
    expect(screen.queryByText(/Note 6/)).toBeNull()
    await user.click(more)
    // Where the row itself goes: the topic, not the file the news came from.
    const rowHref = document.querySelector(`[data-file="${CSS.escape(TOPIC)}"]`)?.closest('a')?.getAttribute('href')
    expect(rowHref).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe(rowHref)
  })
})
