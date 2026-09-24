/**
 * §2.12's rules for a followed file, folded (FOL-34).
 *
 * The topic rules folded here too (SHR-10) until FOL-23 removed the Convex
 * topics they ran on.
 *
 * The case worth naming: **a rule going quiet is invisible.** A Screener with a
 * broken rule and a Screener on a workspace where nothing happened render
 * identically. So every rule gets a pair — the case that must screen and the
 * neighbouring case that must not.
 */
import { describe, expect, it } from 'vitest'
import {
  dmPartnerFromScreenerRowId,
  dmPreviewMessages,
  dmScreenerRowId,
  fileAddressFromScreenerRowId,
  fileScreenerRowId,
  foldDmScreenerRows,
  foldFileScreenerRows,
  type ScreenerDm,
  type ScreenerFile,
} from './screenerFold'
import { containerContext, threadContext } from '@/nostr/readState'
import type { StreamMessage } from '@/nostr/channelStreams'

const T = 1_700_000_000_000

const NO_DECISIONS = { snoozed: {}, dismissed: {} }

describe('a followed file screens while somebody else’s comment on it is unread (FOL-34)', () => {
  const ME = 'me'
  const ADDRESS = `30840:${'b'.repeat(64)}:file-d`
  const S = Math.floor(T / 1000)
  const comment = (over: Partial<ScreenerFile['comments'][number]> = {}) => ({
    id: 'c1',
    author: 'someone',
    body: 'a comment on the file',
    createdAt: S,
    ...over,
  })
  const file = (comments: ScreenerFile['comments']): ScreenerFile => ({
    address: ADDRESS,
    kind: 30840,
    title: 'The file',
    comments,
  })
  const frontier = (marker?: number) => ({
    marker: () => marker,
    me: ME,
    nowSeconds: S + 60,
    horizonSeconds: 90 * 24 * 60 * 60,
  })
  const fold = (
    files: ScreenerFile[],
    over: {
      marker?: number
      decisions?: { snoozed: Record<string, number>; dismissed: Record<string, number> }
      openWork?: Set<string>
      nowMs?: number
    } = {},
  ) =>
    foldFileScreenerRows(
      files,
      over.decisions ?? NO_DECISIONS,
      over.openWork ?? new Set(),
      frontier(over.marker),
      over.nowMs ?? T + 60_000,
    )

  it('a comment newer than the file’s marker is a row, carrying that comment', () => {
    const rows = fold([file([comment()])], { marker: S - 10 })
    expect(rows.map((r) => r.item)).toEqual([
      {
        id: fileScreenerRowId(ADDRESS),
        kind: 'file',
        address: ADDRESS,
        fileKind: 30840,
        title: 'The file',
        preview: 'a comment on the file',
      },
    ])
  })

  it('reading the file retires the row, with no write', () => {
    expect(fold([file([comment()])], { marker: S })).toEqual([])
  })

  it('your own comment never screens', () => {
    expect(fold([file([comment({ author: ME })])], { marker: S - 10 })).toEqual([])
  })

  it('the newest unread comment is the preview, whatever order they arrive in', () => {
    const rows = fold(
      [file([comment({ id: 'c2', body: 'newer', createdAt: S + 5 }), comment({ id: 'c1', body: 'older' })])],
      { marker: S - 10 },
    )
    expect(rows[0].item.preview).toBe('newer')
    expect(rows[0].at).toBe(S + 5)
  })

  it('a dismissal is a watermark: later talk screens again', () => {
    const decisions = { snoozed: {}, dismissed: { [`file:${ADDRESS}`]: S } }
    expect(fold([file([comment()])], { marker: S - 10, decisions })).toEqual([])
    const later = fold([file([comment(), comment({ id: 'c2', body: 'after', createdAt: S + 1 })])], {
      marker: S - 10,
      decisions,
    })
    expect(later[0].item.preview).toBe('after')
  })

  it('a live snooze hides it, and an expired one does not', () => {
    const decisions = { snoozed: { [`file:${ADDRESS}`]: S + 3600 }, dismissed: {} }
    expect(fold([file([comment()])], { marker: S - 10, decisions })).toEqual([])
    expect(fold([file([comment()])], { marker: S - 10, decisions, nowMs: (S + 3601) * 1000 })).toHaveLength(1)
  })

  it('a file in open work does not screen (PEE-6)', () => {
    expect(fold([file([comment()])], { marker: S - 10, openWork: new Set([ADDRESS]) })).toEqual([])
  })

  it('its row id round-trips, and a DM row id is never mistaken for one', () => {
    const id = fileScreenerRowId(ADDRESS)
    expect(fileAddressFromScreenerRowId(id)).toBe(ADDRESS)
    // A DM row, whose dismissal must not go to a file — and the other way round.
    expect(fileAddressFromScreenerRowId(dmScreenerRowId('b'.repeat(64)))).toBeNull()
    expect(dmPartnerFromScreenerRowId(id)).toBeNull()
  })
})

describe('a DM screens while somebody else’s message in it is unread — rule 1 (CON-14)', () => {
  const ME = 'me'
  const PARTNER = 'b'.repeat(64)
  // Real shapes: `containerContext` and `threadContext` refuse anything else,
  // and a marker keyed by `undefined` would answer for every context at once.
  const CHANNEL = '5f0c6a8e-1b2d-4c3e-9f4a-0b1c2d3e4f50'
  const ROOT = 'e'.repeat(64)
  const S = Math.floor(T / 1000)
  const message = (over: Partial<StreamMessage> = {}): StreamMessage => ({
    id: 'm1',
    at: S,
    by: PARTNER,
    root: 'm1',
    about: [],
    urgent: false,
    body: 'hello',
    ...over,
  })
  const dm = (messages: StreamMessage[]): ScreenerDm => ({
    partner: PARTNER,
    channel: CHANNEL,
    authorName: 'Greg',
    messages,
  })
  /** Markers by context: the channel's under `container`, a thread's under `thread`. */
  const fold = (
    dms: ScreenerDm[],
    over: {
      container?: number
      threads?: Record<string, number>
      decisions?: { snoozed: Record<string, number>; dismissed: Record<string, number> }
      openWork?: Set<string>
      nowMs?: number
    } = {},
  ) =>
    foldDmScreenerRows(
      dms,
      over.decisions ?? NO_DECISIONS,
      over.openWork ?? new Set(),
      {
        marker: (context) => {
          if (context === containerContext(CHANNEL)) return over.container
          for (const [root, at] of Object.entries(over.threads ?? {})) if (context === threadContext(root)) return at
          return undefined
        },
        me: ME,
        nowSeconds: S + 60,
        horizonSeconds: 90 * 24 * 60 * 60,
      },
      over.nowMs ?? T,
    )

  it('an unread message from the partner screens, with its text as the preview', () => {
    const rows = fold([dm([message()])], { container: S - 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      at: S,
      messageId: 'm1',
      item: { id: dmScreenerRowId(PARTNER), kind: 'dm', dmId: PARTNER, authorName: 'Greg', preview: 'hello' },
    })
  })

  it('…and a read one does not: reading the DM retires the row with no write', () => {
    expect(fold([dm([message()])], { container: S })).toEqual([])
  })

  it('a DM never opened screens — absent marker, inside the horizon', () => {
    expect(fold([dm([message()])])).toHaveLength(1)
  })

  it('the viewer’s own message does not screen', () => {
    expect(fold([dm([message({ by: ME })])], { container: S - 10 })).toEqual([])
  })

  it('previews the newest unread message, not the newest message', () => {
    const rows = fold(
      [dm([message(), message({ id: 'm2', root: 'm2', at: S + 5, body: 'newer' }), message({ id: 'm3', root: 'm3', at: S + 9, by: ME })])],
      { container: S - 10 },
    )
    expect(rows[0].item.preview).toBe('newer')
  })

  it('a reply answers to the later of the channel’s marker and its thread’s', () => {
    const reply = message({ id: 'f'.repeat(64), root: ROOT, at: S })
    expect(fold([dm([reply])], { container: S - 10 })).toHaveLength(1)
    expect(fold([dm([reply])], { container: S - 10, threads: { [ROOT]: S } })).toEqual([])
    // And the channel's marker alone covers it too — reading the DM reads its replies.
    expect(fold([dm([reply])], { container: S })).toEqual([])
  })

  it('a dismissal is a watermark: later talk screens again', () => {
    const decisions = { snoozed: {}, dismissed: { [`dm:${PARTNER}`]: S } }
    expect(fold([dm([message()])], { container: S - 10, decisions })).toEqual([])
    const later = fold([dm([message(), message({ id: 'm2', root: 'm2', at: S + 1, body: 'after' })])], {
      container: S - 10,
      decisions,
    })
    expect(later[0].item.preview).toBe('after')
  })

  it('a live snooze hides it, and an expired one does not', () => {
    const decisions = { snoozed: { [`dm:${PARTNER}`]: S + 3600 }, dismissed: {} }
    expect(fold([dm([message()])], { container: S - 10, decisions })).toEqual([])
    expect(fold([dm([message()])], { container: S - 10, decisions, nowMs: (S + 3601) * 1000 })).toHaveLength(1)
  })

  it('a file’s decision does not reach a DM, and a DM’s does not reach a file', () => {
    const decisions = { snoozed: {}, dismissed: { [`file:${PARTNER}`]: S + 100 } }
    expect(fold([dm([message()])], { container: S - 10, decisions })).toHaveLength(1)
  })

  it('a DM in open work does not screen (PEE-6)', () => {
    expect(fold([dm([message()])], { container: S - 10, openWork: new Set([PARTNER]) })).toEqual([])
  })

  it('its row id round-trips', () => {
    expect(dmPartnerFromScreenerRowId(dmScreenerRowId(PARTNER))).toBe(PARTNER)
  })

  describe('the hover card’s thread', () => {
    const root = message({ id: 'root', root: 'root', at: S - 100, by: ME, body: 'question' })
    const replies = Array.from({ length: 6 }, (_, i) =>
      message({ id: `r${i}`, root: 'root', at: S - 50 + i, body: `reply ${i}` }),
    )
    const elsewhere = message({ id: 'x', root: 'x', at: S - 10, body: 'elsewhere' })

    it('is the root and its last four replies, oldest first, whichever message screened', () => {
      const all = [elsewhere, ...replies.slice().reverse(), root]
      const bodies = (id: string) => dmPreviewMessages(all, id).map((m) => m.body)
      expect(bodies('r5')).toEqual(['question', 'reply 2', 'reply 3', 'reply 4', 'reply 5'])
      expect(bodies('root')).toEqual(bodies('r5'))
    })

    it('stands on its replies when the root is beyond the horizon', () => {
      expect(dmPreviewMessages(replies.slice(0, 2), 'r1').map((m) => m.body)).toEqual(['reply 0', 'reply 1'])
    })

    it('is empty for a message it does not hold', () => {
      expect(dmPreviewMessages([root], 'gone')).toEqual([])
    })
  })
})
