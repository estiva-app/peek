/**
 * An edit lists every file the message keeps — "Editing can take every file
 * off a message", stage 1.
 *
 * An edit is the whole new message (SPEC §6.8, record
 * an-edit-is-the-whole-new-message): its `imeta` is the message's file set, and
 * none means no files. So an edit that changes only the words still carries the
 * files, or a reader on the new rule takes them off. The real view and
 * `useFileConversation` run over a mocked relay read; what is pinned is the
 * `kind:40003` handed to the signer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UnsignedEvent } from '@estiva-app/protocol'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'

const relay = vi.hoisted(() => ({ read: vi.fn<() => Promise<FileConversation>>() }))
vi.mock('@/nostr/conversationCatchUp', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/conversationCatchUp')),
  readConversation: async () => ({ value: await relay.read(), events: [] }),
  catchUpConversation: async (store: { settle: (key: string, at: number, value: FileConversation) => void }, key: string) => {
    store.settle(key, Date.now(), await relay.read())
    return { changed: true, object: false, mentions: false }
  },
}))
const signed = vi.hoisted(() => ({ events: [] as UnsignedEvent[] }))
vi.mock('@/nostr/bridge', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/bridge')),
  signViaEstivaId: async (unsigned: UnsignedEvent) => {
    signed.events.push(unsigned)
    return { ...unsigned, id: 'e'.repeat(64), sig: 'f'.repeat(128) }
  },
  publishSigned: async () => ({ ok: true }),
}))
const viewer = vi.hoisted(() => () => ({ relayUrl: 'https://relay.test', token: { pubkey: 'a'.repeat(64), accessToken: 't' } }))
vi.mock('@/api/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api/foreign')),
  useRelayViewer: () => viewer,
}))
vi.mock('@/nostr/useLiveFile', () => ({ useLiveFile: () => ({ relayState: 'live' }) }))
vi.mock('@/lib/useRefreshTriggers', () => ({ useRefreshTriggers: () => {} }))
const membership = vi.hoisted(() => ({ refresh: () => Promise.resolve() }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useWorkspaceDirectory: () => people,
  useMembership: () => membership,
  useReadActions: () => ({ markThreadRead: () => {}, markContainerRead: () => {}, markFileRead: () => {} }),
}))
const toast = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToast: () => ({ showToast: toast.show }) }))
vi.mock('@/components/ui/ConversationBox', () => ({ ConversationBox: () => null, ClosedBox: () => null }))
const ADDED = vi.hoisted(() => ({ name: 'new.txt', contentType: 'text/plain', size: 3, sha256: '9'.repeat(64), mediaUrl: `https://relay.test/${'9'.repeat(64)}` }))
// The card's own edit box reports a words-only save as the body alone, as the real one does when the files are unchanged,
// and a change to the files as the set the box holds — each file as the box draws it, its `dim` and the rest not kept.
vi.mock('@/components/ConversationCard', () => ({
  ConversationCard: ({ body, files = [], onBodyChange, onFilesChange }: { body: string; files?: object[]; onBodyChange?: (b: string) => void; onFilesChange?: (f: object[]) => void }) => (
    <>
      <button onClick={() => onBodyChange?.(`${body}, reworded`)}>{body}</button>
      <button onClick={() => onFilesChange?.([])}>Take every file off {body}</button>
      <button onClick={() => onFilesChange?.([...files, ADDED])}>Add a file to {body}</button>
    </>
  ),
}))
vi.mock('@/components/ReplyCard', () => ({
  ReplyCard: ({ body, onBodyChange }: { body: string; onBodyChange?: (b: string) => void }) => (
    <button onClick={() => onBodyChange?.(`${body}, reworded`)}>{body}</button>
  ),
}))

import { useFileConversationView } from './useFileConversationView'

const ME = 'a'.repeat(64)
const people: People = { [ME]: { displayName: 'Me' } } as unknown as People
const T = 1_700_000_000
const file = (name: string, x: string) => ({ name, contentType: 'application/pdf', size: 10, sha256: x.repeat(64), mediaUrl: `https://relay.test/${x.repeat(64)}` })
const root = (files: ReturnType<typeof file>[]) => ({ id: '1'.repeat(64), author: ME, body: 'First', createdAt: T, kind: 1111, files, references: [] })
const conversationOf = (r: ReturnType<typeof root>, byId: FileConversation['decorations']['byId'] = {}): FileConversation => ({
  roots: [r],
  replies: {},
  decorations: { byId, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
})

function View({ openThreadId }: { openThreadId?: string }) {
  const { conversation, threadPanel } = useFileConversationView({
    container: { kind: 'file', address: `30840:${ME}:d`, h: 'team' },
    rootIds: ['1'.repeat(64)],
    openThreadId,
    onOpenThread: () => {},
    title: 'A file',
    onCommented: async () => {},
  })
  return (
    <>
      {conversation}
      {threadPanel}
    </>
  )
}

const sentEdit = async (name = 'First') => {
  await userEvent.click(await screen.findByRole('button', { name }))
  await waitFor(() => expect(signed.events.some((e) => e.kind === 40003)).toBe(true))
  const edit = signed.events.find((e) => e.kind === 40003)!
  return { edit, imeta: edit.tags.filter((t) => t[0] === 'imeta') }
}

afterEach(() => {
  relay.read.mockReset()
  toast.show.mockReset()
  signed.events = []
})

// The tags as the relay must receive them, written out: a lossy encoder would pass a check built with `imetaTag`.
const BRIEF_TAG = ['imeta', `url https://relay.test/${'ab'.repeat(64)}`, 'm application/pdf', `x ${'ab'.repeat(64)}`, 'size 10', 'filename brief.pdf']
const rich = {
  url: `https://relay.test/${'cd'.repeat(64)}`,
  m: 'image/png',
  x: 'cd'.repeat(64),
  size: 20,
  dim: '800x600',
  blurhash: 'LKO2?U%2Tw=w',
  fallback: ['https://a.example/shot.png'],
  filename: 'shot.png',
}
const RICH_TAG = [
  'imeta',
  `url https://relay.test/${'cd'.repeat(64)}`,
  'm image/png',
  `x ${'cd'.repeat(64)}`,
  'size 20',
  'dim 800x600',
  'blurhash LKO2?U%2Tw=w',
  'fallback https://a.example/shot.png',
  'filename shot.png',
]
const editedTo = (attachments: (typeof rich)[]) => ({ ['1'.repeat(64)]: { edit: { body: 'First', edited: false, attachments }, reactions: [], resolutions: [] } })

describe('an edit that changes only the words still lists the message’s files (SPEC §6.8)', () => {
  it('carries the files the message was sent with', async () => {
    relay.read.mockResolvedValue(conversationOf(root([file('brief.pdf', 'ab')])))
    render(<View />)
    const { edit, imeta } = await sentEdit()
    expect(edit.content).toBe('First, reworded')
    expect(imeta).toEqual([BRIEF_TAG])
  })

  it('carries the set an earlier edit left, not the one it was sent with, every field as it was read', async () => {
    relay.read.mockResolvedValue(conversationOf(root([file('brief.pdf', 'ab')]), editedTo([rich])))
    render(<View />)
    const { imeta } = await sentEdit()
    expect(imeta).toEqual([RICH_TAG])
  })

  it('carries the files of a reply, edited in its open thread', async () => {
    const reply = { ...root([file('notes.pdf', 'ef')]), id: '2'.repeat(64), body: 'Answer', createdAt: T + 60, parentId: '1'.repeat(64) }
    relay.read.mockResolvedValue({ ...conversationOf(root([])), replies: { ['1'.repeat(64)]: [reply] } })
    render(<View openThreadId={'1'.repeat(64)} />)
    const { edit, imeta } = await sentEdit('Answer')
    expect(edit.tags).toContainEqual(['e', '2'.repeat(64)])
    expect(imeta).toEqual([['imeta', `url https://relay.test/${'ef'.repeat(64)}`, 'm application/pdf', `x ${'ef'.repeat(64)}`, 'size 10', 'filename notes.pdf']])
  })

  it('control: a message with no files gets an edit with no files', async () => {
    relay.read.mockResolvedValue(conversationOf(root([])))
    render(<View />)
    const { edit, imeta } = await sentEdit()
    expect(edit.content).toBe('First, reworded')
    expect(imeta).toEqual([])
  })
})

describe('an edit that changes the files', () => {
  // Until every reader takes an edit with no `imeta` as "no files" (stage 3), the last file stays and the person is told.
  it('taking the last file off still sends the files the message has, and says it cannot be removed yet', async () => {
    relay.read.mockResolvedValue(conversationOf(root([file('brief.pdf', 'ab')])))
    render(<View />)
    const { imeta } = await sentEdit('Take every file off First')
    expect(imeta).toEqual([BRIEF_TAG])
    expect(toast.show).toHaveBeenCalledWith(expect.objectContaining({ label: 'The last attachment cannot be removed from a message yet.' }))
  })

  it('a file kept beside a new one goes back with every field it was read with', async () => {
    relay.read.mockResolvedValue(conversationOf(root([file('brief.pdf', 'ab')]), editedTo([rich])))
    render(<View />)
    const { imeta } = await sentEdit('Add a file to First')
    expect(imeta).toEqual([RICH_TAG, ['imeta', `url https://relay.test/${'9'.repeat(64)}`, 'm text/plain', `x ${'9'.repeat(64)}`, 'size 3', 'filename new.txt']])
  })
})
