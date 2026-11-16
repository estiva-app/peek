/**
 * A topic's page is its own conversation, whatever the bell says (Katerina, 15 November, PL-01: "we dont need the
 * tabs"): at Everything too it draws its own alone and asks nothing for its files, which are in the side panel, each
 * with its conversation on its own page. Until then (TOPI-3) at All it drew its listed files' threads under headings.
 *
 * The level, the topic's list and the files' conversations are each their own hook's, stubbed here at `@/api` to
 * what they answer; the topic's own conversation is read by the real hook over a mocked relay read. The card is
 * stubbed to its heading and its words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { FileConversation, ForeignConversationState, ListedSource, TopicFile } from '@/api'

const CATH = 'b'.repeat(64)
const T = 1_700_000_000
const TEAM = '2b0c3d4e-5f60-4718-8293-a4b5c6d7e8f9'
const TOPIC = `30840:${CATH}:launch`
const ISSUE = `30851:${CATH}:issue-12`
const NOTES = `30840:${CATH}:launch-notes`
const SHIP_URL = 'https://ship.estiva.app/issue/issue-12'

const conversationOf = (roots: { id: string; body: string; createdAt: number }[]): FileConversation => ({
  roots: roots.map((root) => ({ ...root, author: CATH, kind: 1111, files: [], references: [] })),
  replies: {},
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
  threads: {},
})
const ownRoot = { id: '1'.repeat(64), body: 'Kick-off notes', createdAt: T }
const onIssue = { id: '3'.repeat(64), body: 'Blocked on review', createdAt: T + 60 }
const onNotes = { id: '4'.repeat(64), body: 'Dates moved', createdAt: T + 90 }

const objectOf = (address: string, title: string, extra: Record<string, unknown> = {}) => ({
  ref: address,
  address,
  kind: Number(address.split(':')[0]),
  slots: { title: { value: title } },
  meta: [],
  actions: [{ id: 'comment', label: 'Comment' }],
  ...extra,
})
const topic = objectOf(TOPIC, 'Launch', { naddr: 'naddr1launch', folder: TEAM, comments: [{ id: ownRoot.id, createdAt: T }] })
const listedFiles: TopicFile[] = [
  { file: 'issue-12', address: ISSUE, archived: false, listed: {} as TopicFile['listed'], object: objectOf(ISSUE, 'Issue 12', { openUrl: SHIP_URL }) as never },
  { file: 'launch-notes', address: NOTES, archived: false, listed: {} as TopicFile['listed'], object: objectOf(NOTES, 'Launch notes') as never },
]
const sources: ListedSource[] = [
  { file: 'issue-12', address: ISSUE, folder: 'ship-team', container: { kind: 'file', address: ISSUE, h: 'ship-team' }, conversation: conversationOf([onIssue]), archived: false },
  { file: 'launch-notes', address: NOTES, folder: TEAM, container: { kind: 'file', address: NOTES, h: TEAM }, conversation: conversationOf([onNotes]), archived: false },
]

const level = vi.hoisted(() => ({ shown: 'all' as string }))
const asked = vi.hoisted(() => ({ listed: [] as unknown[] }))
const relay = vi.hoisted(() => ({ read: vi.fn<() => Promise<FileConversation>>() }))
vi.mock('@/nostr/conversationCatchUp', () => ({
  readConversation: async () => ({ value: await relay.read(), events: [] }),
  catchUpConversation: async () => ({ changed: false, object: false, mentions: false }),
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'a'.repeat(64) } }))
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useRelayViewer: () => viewer,
}))
vi.mock('@/nostr/conversationFromCopy', () => ({ conversationFromCopy: async () => Promise.reject(new Error('no copy')) }))
vi.mock('@/nostr/useLiveFile', () => ({ useLiveFile: () => ({ relayState: 'live' }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
vi.mock('@/api/useFileMentions', () => ({ useFileMentions: () => ({ mentions: [] }) }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useForeignConversation: () => ({ state: topic as unknown as ForeignConversationState, reload: async () => {}, previous: null }),
  useFileThreads: () => ({ state: 'loading', reload: async () => {} }),
  useTeams: () => ({ teams: [], failed: false, reload: async () => {} }),
  usePlaceFollow: () => ({ state: { shown: level.shown, againstDefault: false }, listed: [], failed: false, choose: vi.fn(), add: vi.fn() }),
  useTopicFiles: () => ({ state: { files: listedFiles }, busy: new Set(), setListed: vi.fn() }),
  useListedConversations: (listed: unknown) => {
    asked.listed.push(listed)
    return { state: listed ? { files: sources } : 'off', actionsFor: () => undefined }
  },
  useWorkspaceDirectory: () => ({}),
  useMembership: () => ({ refresh: () => Promise.resolve() }),
  useReadActions: () => ({ markThreadRead: () => {}, markContainerRead: () => {}, markFileRead: () => {} }),
}))
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({ marker: () => 4_000_000_000, merged: {}, ready: true }),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/components/ui/ConversationBox', () => ({ ConversationBox: () => null, ClosedBox: () => null }))
vi.mock('@/components/ConversationCard', () => ({
  ConversationCard: ({ body, heading }: { body: string; heading?: ReactNode }) => (
    <article>
      {heading}
      <p>{body}</p>
    </article>
  ),
}))

import { ConversationLayout } from '@estiva-app/ui'
import { useFileView } from './useFileView'

function TopicPage() {
  const view = useFileView({ address: TOPIC, openThreadId: undefined, onOpenThread: () => {} })
  return 'layout' in view.list ? <ConversationLayout threads="beside" {...view.list.layout} /> : null
}
function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}
const page = () => (
  <MemoryRouter initialEntries={['/t']}>
    <Routes>
      <Route path="*" element={<><TopicPage /><Where /></>} />
    </Routes>
  </MemoryRouter>
)

afterEach(() => {
  level.shown = 'all'
  asked.listed = []
  relay.read.mockReset()
  vi.restoreAllMocks()
})

describe('the page is its own conversation whatever the bell says (PL-01)', () => {
  it('at Everything, Important or Not following a topic draws its own conversation alone, and asks nothing for its files', async () => {
    relay.read.mockResolvedValue(conversationOf([ownRoot]))
    const view = render(page())
    await waitFor(() => expect(screen.getByText('Kick-off notes')).toBeInTheDocument())
    for (const shown of ['all', 'important', 'not-following'] as const) {
      level.shown = shown
      view.rerender(page())
      expect(screen.getByText('Kick-off notes')).toBeInTheDocument()
      expect(screen.queryByText('Blocked on review')).toBeNull()
      expect(screen.queryByText('Dates moved')).toBeNull()
    }
    expect(asked.listed).toEqual([])
  })
})
