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
  fileAddressFromScreenerRowId,
  fileScreenerRowId,
  foldFileScreenerRows,
  type ScreenerFile,
} from './screenerFold'

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

  it('its row id round-trips, and a Convex row id is never mistaken for one', () => {
    const id = fileScreenerRowId(ADDRESS)
    expect(fileAddressFromScreenerRowId(id)).toBe(ADDRESS)
    // A Convex `screenerItems` id — the DM half's row id, whose dismissal must
    // not go to a file.
    expect(fileAddressFromScreenerRowId('k17abcdefghijklmnopqrstuvwxyz0123')).toBeNull()
  })
})
