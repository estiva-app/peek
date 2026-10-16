/**
 * A message's links drawn by the kit (Widgets 2, "Peek's messages and
 * 'Mentioned in' draw links from the kit"): where a link sits decides how it
 * draws (SPEC §13.2; record where-a-link-sits-and-which-file-gets-the-card).
 * A link in a sentence is a chip, a line that is only a link to a file is that
 * file's row, a person or a Folder alone stays a chip, and the file its author
 * chose gets the card under the message — which any reader may change from
 * (Decided 16 Oct), with an unread dot only for a member. A preview draws
 * chips only, and "Mentioned in" draws no card for the file it is on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addrToNaddr, encodeNpub, type Embed } from '@estiva-app/protocol'

const SHIP = 'cb77583ed45cac74ce4e46c626c1edada0204a6fc4c91f9c7be230b5af36156c'
const ADA = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const BRUNO = 'f3a38fa6c6a1e5d2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920'
const SENTENCE_ISSUE = `30851:${SHIP}:a0b27d90-d5b9-40e7-8078-865ab36a421c`
const CARD_ISSUE = `30851:${SHIP}:c0b27d90-d5b9-40e7-8078-865ab36a421c`
const PROJECT = `30850:${SHIP}:b0b27d90-d5b9-40e7-8078-865ab36a421c`
const FOLDER = `39000:${BRUNO}:d0b27d90-d5b9-40e7-8078-865ab36a421c`
const ref = (address: string) => `nostr:${addrToNaddr(address, [])}`
const PERSON = `nostr:${encodeNpub(ADA)}`

const base = (address: string, kind: number, title: string) => ({
  ref: address,
  address,
  eventId: 'e'.repeat(64),
  kind,
  widget: 'row',
  appName: 'Ship',
  openUrl: `https://ship.estiva.app/o/${address}`,
  slots: { title: { value: title } },
  meta: [],
  comments: [],
  actions: [],
})
const cardIssue = () => ({
  ...base(CARD_ISSUE, 30851, 'Cards draw from the kit'),
  slots: { title: { value: 'Cards draw from the kit' }, status: { value: 'Todo', colour: 'neutral', field: 'status' } },
  meta: [{ label: 'Assignee', value: ADA, isPubkey: true, field: 'assignee' }],
  people: { [ADA]: { displayName: 'Ada Lovelace' } },
  actions: [
    { id: 'change-status', label: 'Change status', control: 'select', field: 'status', current: 'todo', options: [{ value: 'todo', label: 'Todo', colour: 'neutral' }, { value: 'done', label: 'Done', colour: 'green' }] },
    { id: 'assign-issue', label: 'Assign', control: 'pubkey', field: 'assignee', current: ADA },
  ],
})
let objects: Record<string, unknown> = {}
const byReference = (reference: string) => objects[reference.replace(/^nostr:/, '')]
let unread = false
const applyAction = vi.fn<(change: { naddr: string; actionId: string; value: string }) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))

vi.mock('@/api', () => ({
  TOPICS: [],
  APP_FILES: [],
  DOCUMENT_FILES: [],
  hasRelay: true,
  isFromCopy: () => false,
  useLinkResolver: () => () => undefined,
  useResolvedReferences: (refs: string[]) => Object.fromEntries(refs.map((r) => [r, byReference(r) ?? null])),
  // Never answered: the card waits, as on a slow relay.
  useHeldObject: (naddr: string) => ({ object: objects[naddr] ?? 'loading', reload: async () => {}, gone: false }),
  useForeignObjects: () => ({ applyAction }),
  useWorkspaceDirectory: () => ({ [ADA]: { displayName: 'Ada Lovelace' }, [BRUNO]: { displayName: 'Bruno Ferreira' } }),
  // `useConversationBadges` gates unread on membership itself; this is its answer.
  useConversationBadges: (files?: { ref: string }[]) => ({
    counts: Object.fromEntries((files ?? []).map((f) => [f.ref, 3])),
    unread: Object.fromEntries((files ?? []).map((f) => [f.ref, unread])),
  }),
}))
vi.mock('@/api/mentions', () => ({
  personByPubkey: (pubkey: string) => (pubkey === ADA ? { id: 'ada', name: 'Ada Lovelace', role: 'Engineer' } : undefined),
  subscribeMentions: () => () => {},
  mentionsVersion: () => 0,
}))

import { MessageBody } from './MessageBody'

const naddr = (address: string) => ref(address).replace(/^nostr:/, '')
const show = (body: string, props: { embeds?: Embed[]; here?: string; preview?: boolean } = {}) => render(<MessageBody body={body} {...props} />).container
const rows = (c: HTMLElement) => [...c.querySelectorAll('[data-link-row]')].map((row) => row.textContent)

beforeEach(() => {
  applyAction.mockClear()
  unread = false
  objects = {
    [naddr(SENTENCE_ISSUE)]: base(SENTENCE_ISSUE, 30851, 'Fix the sign-in'),
    [naddr(PROJECT)]: base(PROJECT, 30850, 'Widgets 2'),
    [naddr(CARD_ISSUE)]: cardIssue(),
    [naddr(FOLDER)]: base(FOLDER, 39000, 'Design'),
  }
})

const THE_MESSAGE = `Look at ${ref(SENTENCE_ISSUE)} today.\n\n${ref(PROJECT)}\n\n${ref(CARD_ISSUE)}`
const ITS_CARD: Embed[] = [{ value: CARD_ISSUE, layout: 'detailed' }]

describe('where a link sits decides how it draws', () => {
  it('draws a link in a sentence as its chip, a link alone as its row, and the carded file only as its card', () => {
    const c = show(THE_MESSAGE, { embeds: ITS_CARD })
    expect(c.querySelector('p')?.textContent).toBe('Look at Fix the sign-in today.')
    expect(rows(c)).toEqual(['Widgets 2'])
    const card = c.querySelector('[data-card="detailed"]')
    expect(card?.textContent).toContain('Cards draw from the kit')
    // The carded issue's own line draws nothing: no row, no chip.
    expect(c.textContent?.match(/Cards draw from the kit/g)).toHaveLength(1)
  })

  it('draws a bullet or numbered line that is only a link as a row, keeping its bullet', () => {
    const c = show(`- ${ref(PROJECT)}\n- and ${ref(SENTENCE_ISSUE)} too\n\n1. ${ref(SENTENCE_ISSUE)}`)
    expect(rows(c)).toEqual(['Widgets 2', 'Fix the sign-in'])
    expect(c.querySelector('ul li [data-link-row]')).not.toBeNull()
    expect(c.querySelector('ol li [data-link-row]')).not.toBeNull()
    // A bullet with words around its link is a sentence.
    expect(c.querySelectorAll('ul li')[1].textContent).toBe('and Fix the sign-in too')
  })

  it('keeps a person or a Folder alone on its line a chip', () => {
    const c = show(`${PERSON}\n\n${ref(FOLDER)}`)
    expect(rows(c)).toEqual([])
    expect(c.textContent).toContain('@Ada Lovelace')
    expect(c.textContent).toContain('Design')
  })
})

describe('the card under the message', () => {
  it('changes the issue from its status and assignee, for any reader', async () => {
    show(THE_MESSAGE, { embeds: ITS_CARD })
    await userEvent.click(screen.getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: /Done/ }))
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith({ naddr: naddr(CARD_ISSUE), actionId: 'change-status', value: 'done' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await userEvent.click(await screen.findByRole('option', { name: /Bruno Ferreira/ }))
    await waitFor(() => expect(applyAction).toHaveBeenCalledWith({ naddr: naddr(CARD_ISSUE), actionId: 'assign-issue', value: BRUNO }))
  })

  it('opens the issue’s conversation from its comment count, with a dot only when the reader has something unread there', () => {
    const quiet = show(THE_MESSAGE, { embeds: ITS_CARD })
    const count = quiet.querySelector('[data-card] a[href^="/"]') as HTMLAnchorElement
    expect(count.textContent).toBe('3comments — open the conversation')
    quiet.remove()
    unread = true
    const member = show(THE_MESSAGE, { embeds: ITS_CARD })
    expect(member.querySelector('[data-card]')?.textContent).toContain('comments, unread')
  })

  it('keeps a card’s place while it loads, and says "not available." for a file the reader cannot read', () => {
    delete objects[naddr(CARD_ISSUE)]
    const loading = show(THE_MESSAGE, { embeds: ITS_CARD })
    expect(loading.querySelector('[data-card="detailed"] [aria-busy="true"]')).not.toBeNull()
    loading.remove()
    objects[naddr(CARD_ISSUE)] = { ...cardIssue(), unreachable: true, noun: 'Issue' }
    const unreadable = show(THE_MESSAGE, { embeds: ITS_CARD })
    expect(unreadable.querySelector('[data-card="detailed"]')?.textContent).toBe('Issue — not available.Open in Ship ↗')
  })
})

describe('where the message is shown', () => {
  it('draws no card in "Mentioned in" for the file it is on, and its link stays a chip', () => {
    const c = show(THE_MESSAGE, { embeds: ITS_CARD, here: CARD_ISSUE })
    expect(c.querySelector('[data-card]')).toBeNull()
    expect(rows(c)).toEqual(['Widgets 2'])
    expect(c.textContent).toContain('Cards draw from the kit')
  })

  it('draws a preview’s links as chips only: no row, no card', () => {
    const c = show(THE_MESSAGE, { embeds: ITS_CARD, preview: true })
    expect(c.querySelector('[data-card]')).toBeNull()
    expect(rows(c)).toEqual([])
    expect(c.textContent).toContain('Widgets 2')
    expect(c.textContent).toContain('Cards draw from the kit')
    expect(screen.queryByRole('combobox')).toBeNull()
  })
})

describe('a click on a link', () => {
  it('is the link’s, not the message’s, and another app’s link opens in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const onCard = vi.fn()
    const { container } = render(
      <div onClick={onCard}>
        <MessageBody body={`Look at ${ref(SENTENCE_ISSUE)} today.`} />
      </div>,
    )
    fireEvent.click(container.querySelector('a') as HTMLAnchorElement)
    expect(onCard).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith(`https://ship.estiva.app/o/${SENTENCE_ISSUE}`, '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })
})
