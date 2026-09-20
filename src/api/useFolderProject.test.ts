/**
 * Which objects in a Folder are files *under* this one — CON-9.
 *
 * The whole split turns on this. A comment tagged with the project is a comment
 * on the file the topic *is*, and identity merges, so it stays in the stream. A
 * comment tagged with one of that project's tickets is a different file's
 * conversation and aggregates into Activity.
 *
 * The two failures worth pinning are both silent. Keying by `ref` instead of
 * `address` compiles, reads correctly, and matches nothing — a message carries
 * an `a` tag, which is an address. And including the project itself would pull
 * the topic's own discussion out of the topic.
 */
import { describe, expect, it } from 'vitest'
import type { FolderProject, ForeignObject } from '@estiva-app/interop'
import { partitionByRelation, subFileAddresses, subFileLabels, type FolderProjectState } from './useFolderProject'

const object = (over: Partial<ForeignObject>): ForeignObject =>
  ({
    ref: 'r',
    eventId: 'e',
    kind: 30851,
    widget: 'row',
    slots: {},
    meta: [],
    comments: [],
    ...over,
  }) as ForeignObject

const folder = (tickets: ForeignObject[]): FolderProject =>
  ({
    project: object({ ref: 'p', address: '30850:aa:proj', kind: 30850, slots: { title: { value: 'Payments' } } }),
    tickets,
    openCount: tickets.length,
    doneCount: 0,
  }) as FolderProject

describe('subFileAddresses', () => {
  it('is the tickets, keyed by address rather than ref', () => {
    const state = folder([
      object({ ref: 'r1', address: '30851:aa:pay-1' }),
      object({ ref: 'r2', address: '30851:aa:pay-2' }),
    ])
    expect([...subFileAddresses(state)].sort()).toEqual(['30851:aa:pay-1', '30851:aa:pay-2'])
  })

  /*
    Identity merges. The topic and the project in its Folder are the same file,
    so a comment on the project belongs in the topic's own stream — including it
    here would move the topic's discussion out of the topic.
  */
  it('never includes the project itself', () => {
    const state = folder([object({ ref: 'r1', address: '30851:aa:pay-1' })])
    expect(subFileAddresses(state).has('30850:aa:proj')).toBe(false)
  })

  /*
    A ticket with no address cannot be the target of an `a` tag, so no comment
    can name it. Skipped rather than keyed by `ref`, which would put a value in
    the set that no message will ever carry.
  */
  it('skips a ticket with no address', () => {
    const state = folder([object({ ref: 'r1' }), object({ ref: 'r2', address: '30851:aa:pay-2' })])
    expect([...subFileAddresses(state)]).toEqual(['30851:aa:pay-2'])
  })

  /* Every kind of nothing, so a caller cannot accidentally treat one as "no sub-files known". */
  it.each<[string, FolderProjectState]>([
    ['still loading', 'loading'],
    ['no Folder at all', null],
    ['a relay failure', { failed: 'offline' as never }],
  ])('is empty when the Folder is %s', (_label, state) => {
    expect(subFileAddresses(state).size).toBe(0)
    expect(subFileLabels(state).size).toBe(0)
  })
})

describe('subFileLabels', () => {
  it('names a ticket with its own app’s title slot', () => {
    const state = folder([
      object({ ref: 'r1', address: '30851:aa:pay-1', slots: { title: { value: 'Billing entry' } } as never }),
    ])
    expect(subFileLabels(state).get('30851:aa:pay-1')).toBe('Billing entry')
  })

  it('falls back rather than rendering nothing when a ticket has no title', () => {
    const state = folder([object({ ref: 'r1', address: '30851:aa:pay-1' })])
    expect(subFileLabels(state).get('30851:aa:pay-1')).toBe('Untitled')
  })
})

describe('partitionByRelation', () => {
  const subFiles = new Set(['30851:aa:pay-1', '30851:aa:pay-2'])
  const msg = (id: string, refs?: string[], at?: number) => ({ id, nostrReferences: refs, createdAtMs: at })

  it('keeps talk in the topic, and moves a ticket comment out of it', () => {
    const { own, activity } = partitionByRelation(
      [msg('talk'), msg('comment', ['30851:aa:pay-1'])],
      subFiles,
    )
    expect(own.map((m) => m.id)).toEqual(['talk'])
    expect(activity.map((a) => a.message.id)).toEqual(['comment'])
    expect(activity[0].about).toBe('30851:aa:pay-1')
  })

  /*
    Identity merges. The topic and the project in its Folder are the same file,
    so the project's own comments are the topic's conversation. This is the case
    that would empty a topic completely if the project were treated as a
    sub-file.
  */
  it('keeps a comment on the project itself in the stream', () => {
    const { own, activity } = partitionByRelation([msg('on-project', ['30850:aa:proj'])], subFiles)
    expect(own.map((m) => m.id)).toEqual(['on-project'])
    expect(activity).toEqual([])
  })

  /*
    §5.1, one level up. A person who types a ticket's pointer into a sentence has
    written a message in the topic; they have not written a comment on the
    ticket. `nostrReferences` is tag-derived, so a body-only reference is absent
    from it — this pins that the split reads that field and nothing else.
  */
  it('keeps a message that only names a ticket in its prose', () => {
    const { own, activity } = partitionByRelation(
      [{ id: 'prose', body: 'see nostr:naddr1… for that', createdAtMs: 1 } as never],
      subFiles,
    )
    expect(own.map((m: { id: string }) => m.id)).toEqual(['prose'])
    expect(activity).toEqual([])
  })

  it('orders Activity newest first', () => {
    const { activity } = partitionByRelation(
      [msg('old', ['30851:aa:pay-1'], 100), msg('new', ['30851:aa:pay-2'], 900)],
      subFiles,
    )
    expect(activity.map((a) => a.message.id)).toEqual(['new', 'old'])
  })

  it('sorts an undated message last rather than first', () => {
    const { activity } = partitionByRelation(
      [msg('undated', ['30851:aa:pay-1']), msg('dated', ['30851:aa:pay-2'], 500)],
      subFiles,
    )
    expect(activity.map((a) => a.message.id)).toEqual(['dated', 'undated'])
  })

  /* Before the Folder resolves, nothing is known to be a sub-file — so the
     stream shows everything rather than briefly hiding most of it. */
  it('leaves every message in the stream while the Folder is unresolved', () => {
    const { own, activity } = partitionByRelation([msg('a', ['30851:aa:pay-1'])], new Set())
    expect(own).toHaveLength(1)
    expect(activity).toEqual([])
  })

  /*
    CON-11. A mention is said in another channel, so it is never among the
    messages being partitioned; it arrives already known and joins the one
    list, labelled as what it is, in time order with the sub-file rows rather
    than after them.
  */
  it('merges mentions into Activity as the second relation, in one time order', () => {
    const { own, activity } = partitionByRelation(
      [msg('comment', ['30851:aa:pay-1'], 500), msg('talk', [], 700)],
      subFiles,
      [
        { message: msg('mentioned-late', ['39000:rr:this-topic'], 900), about: '39000:rr:other-topic' },
        { message: msg('mentioned-early', ['39000:rr:this-topic'], 100), about: '39000:rr:other-topic' },
      ],
    )
    expect(own.map((m) => m.id)).toEqual(['talk'])
    expect(activity.map((a) => [a.message.id, a.relation])).toEqual([
      ['mentioned-late', 'mention'],
      ['comment', 'sub-file'],
      ['mentioned-early', 'mention'],
    ])
    expect(activity[0].about).toBe('39000:rr:other-topic')
  })

  it('reports every partitioned row as a sub-file', () => {
    const { activity } = partitionByRelation([msg('comment', ['30851:aa:pay-1'], 1)], subFiles)
    expect(activity[0].relation).toBe('sub-file')
  })
})
