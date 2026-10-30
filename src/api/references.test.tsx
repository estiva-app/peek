/**
 * `[` offers Files, then Messages (Katerina, 30 Oct).
 *
 * Files are the Folder on screen, then what you read recently, then — once you
 * type — the relay's title search. Messages are the thread you are writing in,
 * then the topic around it. A message row names its author and shows its
 * opening words with every `nostr:` reference spelled as a word, and an app
 * link read as what it names once that has come back — never the raw string —
 * and it is found by its own words, not by the links in them.
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
/** What app links name, as far as their answers have come back; asked links are noted. */
const links = vi.hoisted(() => ({ known: {} as Record<string, string>, asked: [] as string[] }))
vi.mock('./foreign', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./foreign')),
  knownCardValue: (url: string) => links.known[url],
  askLinks: async (urls: readonly string[]) => {
    links.asked.push(...urls)
  },
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
import { resetRecentsForTests } from '@/lib/recents'
import { ReferenceSourcesSync, referenceSections, subscribeReferences, useReferenceFolder, useRememberFile } from './references'

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

    const [files, messages] = referenceSections('')
    expect(messages.label).toBe('Messages')
    expect(messages.items.map((i) => i.label)).toEqual(['Miky', 'Katerina'])
    expect(messages.items[0].snippet).toBe('See Message please')
    expect(messages.items.every((i) => !String(i.snippet).includes('nostr:'))).toBe(true)
    expect(files).toMatchObject({ label: 'Files', items: [] })
  })

  it('reads an app link in a message as what it names once it has come back, and asks about it', () => {
    const url = 'https://ship.estiva.app/issue/plan-the-launch-b389d20f'
    links.known = { [url]: address(30851, 'b389d20f') }
    registerActiveConversation({ references: [], messages: [message(4, 'Miky', `Look at ${url} first`)] })

    const [, messages] = referenceSections('')
    expect(messages.items[0].snippet).toBe('Look at Issue first')
    expect(links.asked).toContain(url)
    links.known = {}
  })

  it('finds a message by its own words, not by the link it holds', () => {
    registerActiveConversation({
      references: [],
      messages: [message(5, 'Miky', 'see https://ship.estiva.app/issue/onboarding-checklist-b389d20f'), message(6, 'Ada', 'the onboarding checklist is late')],
    })

    const [, messages] = referenceSections('onboarding')
    expect(messages.items.map((i) => i.label)).toEqual(['Ada'])
  })

  it('reads a list on one line without its markers, as Ship and Leaf caption the same comment (PEEKM-6)', () => {
    registerActiveConversation({ references: [], messages: [message(3, 'Miky', '## Plan\n- [the guide](https://example.com/guide)\n- **second**')] })

    const [, messages] = referenceSections('')
    expect(messages.items[0].snippet).toBe('Plan the guide second')
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

    await waitFor(() => expect(referenceSections('')[0].items).toHaveLength(2))
    expect(labels('')[0]).toEqual(['Files', ['Ranking for [|', 'Launch notes|']])
    expect(referenceSections('')[0].items[0].description).toBe('Peek: Feedback & Bugs')
    // Only read markers that are file addresses, newest first.
    const recent = relay.files.mock.calls.find(([, tier]) => tier === FILE_TIER.recent)?.[0] as { addresses: string[] }
    expect(recent.addresses).toEqual([address(30840, 'new'), address(30851, 'old')])

    folder.unmount()
    // Off the page, that file is just one you read recently.
    expect(labels('')[0]).toEqual(['Files', ['Launch notes|', 'The file you are in|']])
    sync.unmount()
  })

  it("adds the relay's title search once something is typed, and tells the open list", async () => {
    relay.search.mockResolvedValue([file(30850, 'far', 'Ranking elsewhere', FILE_TIER.search)])
    const sync = render(<ReferenceSourcesSync />)
    const listener = vi.fn()
    const unsubscribe = subscribeReferences(listener)

    expect(referenceSections('')[0].items).toEqual([])
    expect(referenceSections('ranking')[0].items).toEqual([])
    await waitFor(() => expect(listener).toHaveBeenCalled())
    expect(relay.search).toHaveBeenCalledWith('ranking')
    expect(labels('ranking')[0]).toEqual(['Files', ['Ranking elsewhere|']])

    unsubscribe()
    sync.unmount()
  })

  it('forgets what was found for someone else once another person is signed in', async () => {
    relay.search.mockResolvedValue([file(30850, 'theirs', 'Payroll', FILE_TIER.search)])
    const sync = render(<ReferenceSourcesSync />)
    const listener = vi.fn()
    const unsubscribe = subscribeReferences(listener)
    referenceSections('payroll')
    await waitFor(() => expect(labels('payroll')[0]).toEqual(['Files', ['Payroll|']]))

    // Nothing re-renders the sync: the next read notices on its own.
    relay.pubkey = 'w'.repeat(64)
    relay.search.mockResolvedValue([])
    expect(referenceSections('payroll')[0].items).toEqual([])

    unsubscribe()
    sync.unmount()
    relay.pubkey = 'v'.repeat(64)
  })

  it('gives a file with a summary its second line, and one without none (SUM-7)', async () => {
    relay.files.mockImplementation(async (_files, tier) => [
      { ...file(30851, 'with', 'Quarter close', tier, 'Finance'), summary: 'Check the Q4 numbers before Friday' },
      file(30840, 'without', 'Launch notes', tier),
    ])
    const folder = renderHook(() => useReferenceFolder({ files: [] } as never, null))
    await waitFor(() => expect(referenceSections('')[0].items).toHaveLength(2))
    const items = referenceSections('')[0].items
    const withSummary = items.find((i) => i.label === 'Quarter close')
    const without = items.find((i) => i.label === 'Launch notes')!
    expect(withSummary).toMatchObject({ label: 'Quarter close', summary: 'Check the Q4 numbers before Friday', description: 'Finance' })
    expect(without.summary).toBeUndefined()
    folder.unmount()
  })
})

describe('useRememberFile — the launcher’s Recent (SUM-7)', () => {
  const opened = (summary?: string) =>
    ({ address: address(30851, 'open'), kind: 30851, slots: { title: { value: 'Quarter close' }, ...(summary ? { subtitle: { value: summary } } : {}) } }) as never
  const stored = () => JSON.parse(window.localStorage.getItem('estiva-peek:recents') ?? '[]')[0]
  beforeEach(() => {
    window.localStorage.removeItem('estiva-peek:recents')
    resetRecentsForTests()
  })

  it('remembers an opened file with its summary and an issue’s project, and reads it once per change, not per refresh', async () => {
    relay.files.mockImplementation(async (_files, tier) => [
      { ...file(30851, 'open', 'Quarter close', tier, 'Finance'), summary: 'Check the Q4 numbers' },
    ])
    const hook = renderHook(({ f }) => useRememberFile(f), { initialProps: { f: opened('Check the Q4 numbers') } })
    await waitFor(() => expect(stored()).toMatchObject({ kind: 'file', id: address(30851, 'open'), title: 'Quarter close', summary: 'Check the Q4 numbers', caption: 'Finance' }))
    // A refresh of the same file hands over a new object: nothing is read again.
    hook.rerender({ f: opened('Check the Q4 numbers') })
    expect(relay.files).toHaveBeenCalledTimes(1)
    hook.unmount()
  })

  it('remembers a file with no summary by its title alone, as before', async () => {
    relay.files.mockImplementation(async (_files, tier) => [file(30840, 'open', 'Quarter close', tier)])
    renderHook(() => useRememberFile(opened()))
    await waitFor(() => expect(stored()).toEqual({ kind: 'file', id: address(30851, 'open'), title: 'Quarter close' }))
  })

  it('lists the file as soon as it opens, even if the person leaves before the relay answers', () => {
    relay.files.mockImplementation(() => new Promise(() => {}))
    const hook = renderHook(() => useRememberFile(opened('Check the Q4 numbers')))
    hook.unmount()
    expect(stored()).toMatchObject({ kind: 'file', id: address(30851, 'open'), title: 'Quarter close' })
  })

  it('asks again on the next refresh when the read failed, and then shows the summary', async () => {
    relay.files.mockRejectedValueOnce(new Error('429'))
    relay.files.mockImplementation(async (_files, tier) => [{ ...file(30851, 'open', 'Quarter close', tier, 'Finance'), summary: 'Check the Q4 numbers' }])
    const hook = renderHook(({ f }) => useRememberFile(f), { initialProps: { f: opened('Check the Q4 numbers') } })
    await waitFor(() => expect(relay.files).toHaveBeenCalledTimes(1))
    hook.rerender({ f: opened('Check the Q4 numbers') })
    await waitFor(() => expect(stored()).toMatchObject({ summary: 'Check the Q4 numbers', caption: 'Finance' }))
  })
})
