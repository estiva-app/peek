/**
 * One control is the follow level (TOPI-3, Decided): a topic followed at All draws its listed files' threads in its
 * middle column, each under its file's heading; at Important (and Not following, or muted, which shows as Not
 * following) it draws its own alone and asks nothing for its files. The heading's name opens the file where its
 * Overview card does: another app's in that app, in a new tab; one Peek opens itself in Peek.
 *
 * The level, the topic's list and the files' conversations are each their own hook's, stubbed here at `@/api` to
 * what they answer; the topic's own conversation is read by the real hook over a mocked relay read. The card is
 * stubbed to its heading and its words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('the follow level decides what a topic draws (TOPI-3)', () => {
  it("at All the files' threads are drawn under their headings; at Important the topic's own alone, and nothing is asked for its files", async () => {
    relay.read.mockResolvedValue(conversationOf([ownRoot]))
    const view = render(page())
    await waitFor(() => expect(screen.getByText('Blocked on review')).toBeInTheDocument())
    expect(screen.getByText('Dates moved')).toBeInTheDocument()
    expect(screen.getByText('Blocked on review').closest('article')!.textContent).toContain('Issue 12')
    expect(screen.getByText('Kick-off notes').closest('article')!.textContent).toBe('Kick-off notes')

    level.shown = 'important'
    view.rerender(page())
    await waitFor(() => expect(screen.queryByText('Blocked on review')).toBeNull())
    expect(screen.queryByText('Dates moved')).toBeNull()
    expect(screen.getByText('Kick-off notes')).toBeInTheDocument()
    expect(asked.listed.at(-1)).toBeNull()

    // Not following (a mute shows as it): the same.
    level.shown = 'not-following'
    view.rerender(page())
    expect(screen.queryByText('Blocked on review')).toBeNull()
    expect(screen.getByText('Kick-off notes')).toBeInTheDocument()
    expect(asked.listed.at(-1)).toBeNull()
  })
})

describe("a file's heading opens the file where its card does (TOPI-3)", () => {
  it("another app's file opens in that app, in a new tab; a file Peek opens itself opens in Peek", async () => {
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    relay.read.mockResolvedValue(conversationOf([ownRoot]))
    render(page())
    await waitFor(() => expect(screen.getByText('Blocked on review')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Issue 12'))
    expect(opened).toHaveBeenCalledWith(SHIP_URL, '_blank', 'noopener,noreferrer')
    expect(screen.getByTestId('where').textContent).toBe('/t')

    act(() => void fireEvent.click(screen.getByText('Launch notes')))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toContain('launch-notes'))
    expect(opened).toHaveBeenCalledTimes(1)
  })
})
