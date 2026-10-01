import { describe, expect, it } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { fileMatches, folderMatches } from './treeFilter'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const PK = 'b'.repeat(64)

const file = (d: string): ForeignObject =>
  ({ ref: `30840:${PK}:${d}`, address: `30840:${PK}:${d}`, slots: {} }) as unknown as ForeignObject
/* A row with no address: the launcher's recommendations and anything a
   manifest could not place. It cannot be followed, so it is never a match. */
const anonymous = (ref: string): ForeignObject => ({ ref, slots: {} }) as unknown as ForeignObject

const A = file('a')
const B = file('b')

describe('folderMatches — All keeps everything', () => {
  it('keeps a Folder nothing was said about', () => {
    expect(folderMatches('all', FOLDER, {}, {})).toBe(true)
  })
})

/*
  The rule is the dot's rule: `=== true`. A Folder with no entry was not judged
  and draws no dot, so a filter that kept it would be showing a Folder the
  column is not claiming anything about.
*/
describe('folderMatches — Unread and Joined read their own map', () => {
  it('keeps a lit Folder and drops a dark one', () => {
    expect(folderMatches('unread', FOLDER, { [FOLDER]: true }, {})).toBe(true)
    expect(folderMatches('unread', FOLDER, { [FOLDER]: false }, {})).toBe(false)
  })

  it('drops a Folder it was told nothing about', () => {
    expect(folderMatches('unread', FOLDER, {}, {})).toBe(false)
    expect(folderMatches('joined', FOLDER, {}, {})).toBe(false)
  })

  it('does not read the dots for Joined, or the memberships for Unread', () => {
    expect(folderMatches('joined', FOLDER, { [FOLDER]: true }, {})).toBe(false)
    expect(folderMatches('unread', FOLDER, {}, { [FOLDER]: true })).toBe(false)
  })
})

describe('fileMatches — a row, or a child the same read listed', () => {
  const none = () => false
  const only =
    (...keys: string[]) =>
    (key: string) =>
      keys.includes(key)

  it('keeps every row under All', () => {
    expect(fileMatches('all', A, [], {}, none)).toBe(true)
  })

  it('keeps a row with a dot, and drops one without', () => {
    expect(fileMatches('unread', A, [], { [A.ref]: true }, none)).toBe(true)
    expect(fileMatches('unread', A, [], { [A.ref]: false }, none)).toBe(false)
    // Unjudged is not unread — the same `=== true` as the dot beside it.
    expect(fileMatches('unread', A, [], {}, none)).toBe(false)
  })

  /*
    The parents of a match are drawn (Miky, FOL-41): a row that does not match
    survives because something it holds does, and `FileTreeView` is what then
    starts it expanded.
  */
  it('keeps a row whose listed child matches', () => {
    expect(fileMatches('unread', A, [B], { [B.ref]: true }, none)).toBe(true)
    expect(fileMatches('joined', A, [B], {}, only(B.address!))).toBe(true)
  })

  it('keeps a joined row, and drops one that is merely lit', () => {
    expect(fileMatches('joined', A, [], { [A.ref]: true }, none)).toBe(false)
    expect(fileMatches('joined', A, [], {}, only(A.address!))).toBe(true)
  })

  it('never matches a row with no address under Joined', () => {
    expect(fileMatches('joined', anonymous('r'), [], {}, only('r'))).toBe(false)
  })
})
