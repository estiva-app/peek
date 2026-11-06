/**
 * From the relay's events to what the cards take — `project` in
 * `useFileConversationView` (FOL-31).
 *
 * The cards were written for Convex rows, where a name, an aggregate reaction
 * and a resolution were all computed server-side. Here they are computed from
 * the events themselves, and each rule is pinned: who is "You", which pill is
 * yours, whose edit shows, and what the last resolution means.
 */
import { describe, expect, it } from 'vitest'
import type { People } from '@estiva-app/interop'
import type { FileConversation } from '@/api'
import { project } from './useFileConversationView'

const ME = 'a'.repeat(64)
const CATH = 'b'.repeat(64)
const STRANGER = 'c'.repeat(64)
const people: People = {
  [ME]: { displayName: 'Miky', picture: 'https://p/miky.png' },
  [CATH]: { displayName: 'Cath', picture: 'https://p/cath.png' },
} as unknown as People

const T = 1_700_000_000
const event = (id: string, author: string, body: string, at = T) => ({
  id: id.repeat(64).slice(0, 64),
  author,
  body,
  createdAt: at,
  kind: 1111,
  files: [],
  references: [],
})
const rootA = event('1', CATH, 'First')
const rootB = event('2', STRANGER, 'Second', T + 60)
const reply = event('3', ME, 'Agreed', T + 120)

const conversation = (over: Partial<FileConversation> = {}): FileConversation => ({
  roots: [rootB, rootA],
  replies: { [rootA.id]: [reply] },
  decorations: { byId: {}, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
  threads: {},
  ...over,
})
const decorations = (byId: FileConversation['decorations']['byId'], over: Partial<FileConversation['decorations']> = {}): FileConversation['decorations'] => ({
  byId,
  reactionTargetsOmitted: 0,
  reactionEventsCut: false,
  editEventsCut: false,
  ...over,
})

describe('project', () => {
  it("marks an agent's message, reply and reply face from its profile (NIP-24 `bot`), never from its name", () => {
    const AGENT = 'd'.repeat(64)
    const withAgent = { ...people, [AGENT]: { displayName: 'Claude (steered by Cath)', bot: true }, [STRANGER]: { displayName: 'Claude (steered by Miky)' } } as unknown as People
    const agentReply = event('4', AGENT, 'On it', T + 180)
    const agentRoot = event('5', AGENT, 'Started', T + 240)
    const view = project(conversation({ roots: [rootB, rootA, agentRoot], replies: { [rootA.id]: [reply, agentReply] } }), ME, withAgent)
    const [cath, stranger, agent] = view.roots
    expect(agent.authorBot).toBe(true)
    expect(cath.authorBot).toBe(false)
    expect(stranger.authorBot).toBe(false)
    expect(view.byId[rootA.id].replies.map((r) => r.authorBot)).toEqual([false, true])
    expect(cath.replyAuthors?.map((a) => a.bot)).toEqual([false, true])
  })

  it('orders roots oldest first, names people from the directory, someone it cannot name a dash, and the viewer as You', () => {
    const view = project(conversation(), ME, people)
    // A dash, as the kit's Person draws a nameless person: never part of their key (A27).
    expect(view.roots.map((r) => r.authorName)).toEqual(['Cath', '—'])
    expect(view.roots[0].authorAvatarSrc).toBe('https://p/cath.png')
    expect(view.byId[rootA.id].replies[0].authorName).toBe('You')
    expect(view.roots[0]).toMatchObject({ replyCount: 1, replyAuthors: [{ name: 'You', avatarSrc: 'https://p/miky.png' }] })
    expect(view.roots[1].replyCount).toBe(0)
  })

  it('shows the newest edit as the body and tells the card when it happened', () => {
    const edit = { body: 'First, corrected', edited: true, editedAt: (T + 30) * 1000, attachments: [] }
    const view = project(conversation({ decorations: decorations({ [rootA.id]: { edit, reactions: [], resolutions: [] } }) }), ME, people)
    expect(view.roots[0].body).toBe('First, corrected')
    expect(view.roots[0].editedAt).toBe((T + 30) * 1000)
    expect(view.roots[1].editedAt).toBeUndefined()
  })

  it("draws the cards an edit chose in place of the message's own (SPEC §13.6.2)", () => {
    const issue = `30851:${CATH}:issue`
    const asked = { ...rootA, embeds: [{ value: issue, layout: 'detailed' as const }] }
    const kept = { ...reply, embeds: [{ value: issue, layout: 'compact' as const }] }
    const view = project(
      conversation({ roots: [rootB, asked], replies: { [rootA.id]: [kept] }, editedEmbeds: { [rootA.id]: [{ value: issue, layout: 'none' }] } }),
      ME,
      people,
    )
    expect(view.roots[0].embeds).toEqual([{ value: issue, layout: 'none' }])
    expect(view.byId[rootA.id].replies[0].embeds).toEqual([{ value: issue, layout: 'compact' }])
    expect(view.roots[1].embeds).toBeUndefined()
  })

  it("draws an edit's attachment set in place of the comment's own, and an attach-only edit unmarked (CON-5)", () => {
    const own = { name: 'old.png', contentType: 'image/png', size: 1, sha256: 'old', mediaUrl: 'https://m/old' }
    const imeta = (name: string, x: string, size: number) => ({ url: `https://m/${x}`, m: 'image/png', x, size, filename: name })
    const withFile = { ...rootA, files: [own] }
    const view = project(
      conversation({
        roots: [withFile, rootB],
        replies: { [rootA.id]: [{ ...reply, files: [own] }] },
        decorations: decorations({
          [rootA.id]: { edit: { body: 'First', edited: false, attachments: [imeta('old.png', 'old', 1), imeta('new.png', 'new', 2)] }, reactions: [], resolutions: [] },
          [reply.id]: { edit: { body: 'Agreed', edited: false, attachments: [] }, reactions: [], resolutions: [] },
        }),
      }),
      ME,
      people,
    )
    expect(view.roots[0].files?.map((f) => f.sha256)).toEqual(['old', 'new'])
    expect(view.roots[0].editedAt).toBeUndefined()
    // An edit with no files takes the reply's own off (SPEC §6.8).
    expect(view.byId[rootA.id].replies[0].files).toEqual([])
    expect(project(conversation({ roots: [withFile] }), ME, people).roots[0].files?.map((f) => f.sha256)).toEqual(['old'])
  })

  it('groups reactions per emoji, marks the pill the viewer is in, and keeps every reaction for the toggle', () => {
    const r1 = { id: 'r1', target: rootA.id, emoji: '👍', by: CATH, at: T + 1 }
    const r2 = { id: 'r2', target: rootA.id, emoji: '👍', by: ME, at: T + 2 }
    const r3 = { id: 'r3', target: rootA.id, emoji: '🎉', by: CATH, at: T + 3 }
    const view = project(
      conversation({
        decorations: decorations({ [rootA.id]: { reactions: [r1, r2, r3], resolutions: [] } }, { reactionTargetsOmitted: 7, reactionEventsCut: true }),
      }),
      ME,
      people,
    )
    expect(view.roots[0].reactions).toEqual([
      { emoji: '👍', by: [CATH, 'You'], names: { [CATH]: 'Cath', You: 'You' } },
      { emoji: '🎉', by: [CATH], names: { [CATH]: 'Cath' } },
    ])
    expect(view.reactionsById[rootA.id]).toEqual([r1, r2, r3])
    expect(view.reactionTargetsOmitted).toBe(7)
    expect(view.reactionEventsCut).toBe(true)
  })

  it('counts two people with the same name as two reactors, each by their key (SPEC §6.6, ONE-9)', () => {
    const twin = { ...people, [STRANGER]: { displayName: 'Cath' } } as unknown as People
    const r1 = { id: 'r1', target: rootA.id, emoji: '👍', by: CATH, at: T + 1 }
    const r2 = { id: 'r2', target: rootA.id, emoji: '👍', by: STRANGER, at: T + 2 }
    const view = project(conversation({ decorations: decorations({ [rootA.id]: { reactions: [r1, r2], resolutions: [] } }) }), ME, twin)
    expect(view.roots[0].reactions).toEqual([{ emoji: '👍', by: [CATH, STRANGER], names: { [CATH]: 'Cath', [STRANGER]: 'Cath' } }])
  })

  it('never names another person as the viewer, even one who calls themselves "You" — their pill would light as yours', () => {
    const impostor = { ...people, [STRANGER]: { displayName: 'you' } } as unknown as People
    const r1 = { id: 'r1', target: rootA.id, emoji: '👍', by: STRANGER, at: T + 1 }
    const view = project(conversation({ decorations: decorations({ [rootA.id]: { reactions: [r1], resolutions: [] } }) }), ME, impostor)
    expect(view.roots[0].reactions).toEqual([{ emoji: '👍', by: [STRANGER], names: { [STRANGER]: '—' } }])
  })

  it("offers Edit and Delete only on the viewer's own — not another person's, an agent's or an unread profile's (SPEC §6.5, SHI-29)", () => {
    const BOT = 'd'.repeat(64)
    const byBot = event('4', BOT, 'Done', T + 180)
    const withBot = { ...people, [BOT]: { displayName: 'Helper', bot: true } } as unknown as People
    const view = project(conversation({ roots: [rootA, rootB, byBot] }), ME, withBot)
    expect(view.roots.map((r) => r.canEditAndDelete)).toEqual([false, false, false])
    expect(view.byId[rootA.id].replies[0].canEditAndDelete).toBe(true)
    // The same while the directory loads, and nothing with no viewer.
    expect(project(conversation({ roots: [rootA, rootB, byBot] }), ME, undefined).roots.map((r) => r.canEditAndDelete)).toEqual([false, false, false])
    expect(project(conversation(), ME, undefined).byId[rootA.id].replies[0].canEditAndDelete).toBe(true)
    expect(project(conversation({ roots: [rootA, rootB, byBot] }), null, withBot).roots.map((r) => r.canEditAndDelete)).toEqual([false, false, false])
  })

  it('the resolve the shared fold counts decides: resolved with its rationale and the reply that carried it, or reopened', () => {
    const resolved = { id: 'x1', action: 'resolved' as const, by: ME, at: T + 200, orderMs: (T + 200) * 1000, message: 'shipped', supportingEventId: reply.id }
    const reopened = { id: 'x2', action: 'reopened' as const, by: CATH, at: T + 300, orderMs: (T + 300) * 1000 }
    // A later resolve the fold did not count (§6.4, C51: filed outside the thread's Folder, say) is in the history, and decides nothing.
    const uncounted = { id: 'x3', action: 'reopened' as const, by: STRANGER, at: T + 250, orderMs: (T + 250) * 1000 }
    const once = project(
      conversation({
        decorations: { byId: { [rootA.id]: { reactions: [], resolutions: [resolved, uncounted] } }, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
        threads: { [rootA.id]: { state: 'present', resolution: resolved } },
      }),
      ME,
      people,
    )
    expect(once.roots[0]).toMatchObject({ isResolved: true, resolvedBy: 'You', resolutionMessage: 'shipped' })
    expect(once.byId[rootA.id].resolvedByReplyId).toBe(reply.id)
    expect(once.byId[rootA.id].resolutionEvents[0]).toEqual({
      kind: 'resolved',
      by: 'You',
      byId: ME,
      byAvatarUrl: 'https://p/miky.png',
      atMs: (T + 200) * 1000,
      message: 'shipped',
      key: 'x1',
      trusted: true,
    })

    const twice = project(
      conversation({
        decorations: { byId: { [rootA.id]: { reactions: [], resolutions: [resolved, reopened] } }, reactionTargetsOmitted: 0, reactionEventsCut: false, editEventsCut: false },
        threads: { [rootA.id]: { state: 'present', resolution: reopened } },
      }),
      ME,
      people,
    )
    expect(twice.roots[0]).toMatchObject({ isResolved: false, resolvedBy: undefined, resolutionMessage: undefined })
    expect(twice.byId[rootA.id].resolvedByReplyId).toBeUndefined()
    expect(twice.byId[rootA.id].resolutionEvents.map((e) => e.kind)).toEqual(['resolved', 'reopened'])
  })

  it('draws a gone comment as deleted or can’t be shown, still resolved when it was, and offers nothing on it (§6.5, ONE-9)', () => {
    const resolved = { id: 'x1', action: 'resolved' as const, by: CATH, at: T + 200, orderMs: (T + 200) * 1000, message: 'shipped' }
    const standIn = (deleted: boolean) => ({ ...event('9', '', '', T + 120), ...(deleted ? { deleted: true as const } : { unseen: true as const }) })
    for (const deleted of [true, false]) {
      const gone = standIn(deleted)
      const view = project(
        conversation({
          roots: [rootA, gone],
          replies: { [gone.id]: [reply] },
          threads: { [gone.id]: { state: deleted ? 'deleted' : 'missing', resolution: resolved } },
        }),
        ME,
        people,
      )
      const card = view.byId[gone.id].data
      expect(card).toMatchObject({ isResolved: true, resolvedBy: 'Cath', resolutionMessage: 'shipped', authorName: '', canEditAndDelete: false })
      expect(card.isDeleted === true).toBe(deleted)
      expect(card.isUnseen === true).toBe(!deleted)
      expect(view.byId[gone.id].replies.map((r) => r.body)).toEqual(['Agreed'])
    }
  })

  it('carries the relay’s attachments and references through, and the event id for the permalink', () => {
    const file = { name: 'shot.png', contentType: 'image/png', size: 2048, sha256: 'abc', mediaUrl: 'https://r/abc', thumbUrl: 'https://r/abc/t' }
    const view = project(
      conversation({ roots: [{ ...rootA, files: [file], references: ['30851:x:y'] }], replies: {} }),
      ME,
      people,
    )
    expect(view.roots[0].files).toEqual([file])
    expect(view.roots[0].nostrReferences).toEqual(['30851:x:y'])
    expect(view.roots[0].nostrEventId).toBe(rootA.id)
  })
})
