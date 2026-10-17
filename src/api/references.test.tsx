/**
 * `[` offers Messages, then Files (PEE-21).
 *
 * Messages are the thread you are writing in, then the topic around it. Files
 * are the Folder on screen, then what you read recently, then — once you type —
 * the relay's title search. A message row names its author and shows its
 * opening words with every `nostr:` reference spelled as a word, never the raw
 * string production showed before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, renderHook, waitFor } from '@testing-library/react'
import { FILE_TIER, messageReference, type ReferenceCandidate } from '@estiva-app/conversation'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', () => ({ validToken: () => ({ accessToken: 't', pubkey: relay.pubkey }), storedToken: () => ({ accessToken: 't', pubkey: relay.pubkey }) }))

const relay = vi.hoisted(() => ({
  pubkey: 'v'.repeat(64),
  files: vi.fn<(files: unknown, tier: number) => Promise<unknown[]>>(async () => []),
  search: vi.fn<(text: string) => Promise<unknown[]>>(async () => []),
  merged: {} as Record<string, number>,
}))
vi.mock('@/nostr/foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/foreign')),
  fileCandidatesAsViewer: (files: unknown, tier: number) => relay.files(files, tier),
  searchFileReferencesAsViewer: (text: string) => relay.search(text),
}))
vi.mock('@/nostr/useReadStateSync', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/nostr/useReadStateSync')),
  useReadFrontier: () => ({ marker: () => undefined, merged: relay.merged }),
}))

import {
  registerActiveConversation,
  registerTopicConversation,
  unregisterActiveConversation,
  unregisterTopicConversation,
} from '@/lib/conversationRegistry'
import { ReferenceSourcesSync, referenceSections, subscribeReferences, useReferenceFolder } from './references'

const AUTHOR = 'a'.repeat(64)
const EVENT = (n: number) => String(n).repeat(64).slice(0, 64)
const address = (kind: number, d: string) => `${kind}:${AUTHOR}:${d}`

function file(kind: number, d: string, title: string, tier: number, caption = ''): ReferenceCandidate {
  const type = kind === 30851 ? 'issue' : kind === 30850 ? 'project' : 'topic'
  return { id: address(kind, d), uri: `nostr:${d}`, type, kind, title, caption, tier }
}

const message = (n: number, author: string, body: string) => ({ id: `m${n}`, author, timestamp: '9:41 AM', body, eventId: EVENT(n) })

const labels = (query: string) => referenceSections(query).map((s) => [s.label, s.items.map((i) => `${i.label}|${i.snippet}`)])

beforeEach(() => {
  relay.files.mockReset().mockResolvedValue([])
  relay.search.mockReset().mockResolvedValue([])
  relay.merged = {}
})
afterEach(() => {
  unregisterActiveConversation()
  unregisterTopicConversation()
})

describe('referenceSections', () => {
  it('lists the thread before the topic around it, and spells references as words', () => {
    registerTopicConversation({ references: [], messages: [message(1, 'Katerina', 'Topic opener')] })
    registerActiveConversation({
      references: [],
      messages: [message(2, 'Miky', `See ${messageReference(EVENT(1), 9)} please`)],
    })

    const [messages, files] = referenceSections('')
    expect(messages.label).toBe('Messages')
    expect(messages.items.map((i) => i.label)).toEqual(['Miky', 'Katerina'])
    expect(messages.items[0].snippet).toBe('See Message please')
    expect(messages.items.every((i) => !String(i.snippet).includes('nostr:'))).toBe(true)
    expect(files).toMatchObject({ label: 'Files', items: [] })
  })

  it('offers the Folder on screen first, then what was read recently, by title alone — the row’s icon says what it is (7 October)', async () => {
    relay.merged = { [address(30851, 'old')]: 100, 'h:not-an-address': 300, [address(30840, 'new')]: 200 }
    relay.files.mockImplementation(async (_files, tier) =>
      tier === FILE_TIER.folder
        ? [file(30851, 'here', 'Ranking for [', tier, 'Peek: Feedback & Bugs'), file(30840, 'open', 'The file you are in', tier)]
        : [file(30840, 'new', 'Launch notes', tier), file(30840, 'open', 'The file you are in', tier)],
    )
    const sync = render(<ReferenceSourcesSync />)
    // The page's own file is in its Folder and was just read; it is offered from neither.
    const folder = renderHook(() => useReferenceFolder({ files: [] } as never, address(30840, 'open')))

    await waitFor(() => expect(referenceSections('')[1].items).toHaveLength(2))
    expect(labels('')[1]).toEqual(['Files', ['Ranking for [|', 'Launch notes|']])
    expect(referenceSections('')[1].items[0].description).toBe('Peek: Feedback & Bugs')
    // Only read markers that are file addresses, newest first.
    const recent = relay.files.mock.calls.find(([, tier]) => tier === FILE_TIER.recent)?.[0] as { addresses: string[] }
    expect(recent.addresses).toEqual([address(30840, 'new'), address(30851, 'old')])

    folder.unmount()
    // Off the page, that file is just one you read recently.
    expect(labels('')[1]).toEqual(['Files', ['Launch notes|', 'The file you are in|']])
    sync.unmount()
  })

  it("adds the relay's title search once something is typed, and tells the open list", async () => {
    relay.search.mockResolvedValue([file(30850, 'far', 'Ranking elsewhere', FILE_TIER.search)])
    const sync = render(<ReferenceSourcesSync />)
    const listener = vi.fn()
    const unsubscribe = subscribeReferences(listener)

    expect(referenceSections('')[1].items).toEqual([])
    expect(referenceSections('ranking')[1].items).toEqual([])
    await waitFor(() => expect(listener).toHaveBeenCalled())
    expect(relay.search).toHaveBeenCalledWith('ranking')
    expect(labels('ranking')[1]).toEqual(['Files', ['Ranking elsewhere|']])

    unsubscribe()
    sync.unmount()
  })

  it('forgets what was found for someone else once another person is signed in', async () => {
    relay.search.mockResolvedValue([file(30850, 'theirs', 'Payroll', FILE_TIER.search)])
    const sync = render(<ReferenceSourcesSync />)
    const listener = vi.fn()
    const unsubscribe = subscribeReferences(listener)
    referenceSections('payroll')
    await waitFor(() => expect(labels('payroll')[1]).toEqual(['Files', ['Payroll|']]))

    // Nothing re-renders the sync: the next read notices on its own.
    relay.pubkey = 'w'.repeat(64)
    relay.search.mockResolvedValue([])
    expect(referenceSections('payroll')[1].items).toEqual([])

    unsubscribe()
    sync.unmount()
    relay.pubkey = 'v'.repeat(64)
  })
})
