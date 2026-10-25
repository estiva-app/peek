import { describe, expect, it } from 'vitest'
import { archiveImpactWords, archivedLineOf, countOf, kindNoun, listOf } from './archiveWords'

/**
 * The archive warning's words (FOL-46). Kinds are named from the words their
 * manifests declare for links, so these pass a registry the way the manifests
 * would fill it — Peek itself names no kind of Ship's.
 */
const words = {
  byWord: { topic: [30840], project: [30850], issue: [30851] },
  byKind: { 30840: 'topic', 30850: 'project', 30851: 'issue' },
}

describe('archive words', () => {
  it('names a kind by its declared word, a Folder as a folder, and anything else as a file', () => {
    expect(kindNoun(30851, words)).toBe('issue')
    expect(kindNoun(39000, words)).toBe('folder')
    expect(kindNoun(31999, words)).toBe('file')
  })

  it('says the line in the box’s place: the file itself, or the closest archived file above it by its kind', () => {
    expect(archivedLineOf({}, words)).toBe('Archived. Unarchive it to comment.')
    expect(archivedLineOf({ with: `30850:${'a'.repeat(64)}:p` }, words)).toBe('Unarchive the project to comment.')
    expect(archivedLineOf({ with: `39000:${'a'.repeat(64)}:f` }, words)).toBe('Unarchive the Folder to comment.')
    expect(archivedLineOf(undefined, words)).toBeUndefined()
  })

  it('counts in the singular and the plural', () => {
    expect(countOf(30851, 1, words)).toBe('1 issue')
    expect(countOf(30851, 14, words)).toBe('14 issues')
  })

  it('words an impact as Ship does: each kind counted, what stays visible grouped by Folder', () => {
    const worded = archiveImpactWords(
      {
        hides: [
          { kind: 30851, count: 14 },
          { kind: 30840, count: 6 },
        ],
        staysVisible: [
          { address: '30840:a:1', kind: 30840, in: [{ id: 'hq', name: 'Estiva HQ' }] },
          { address: '30840:a:2', kind: 30840, in: [{ id: 'hq', name: 'Estiva HQ' }] },
        ],
      },
      words,
    )
    expect(worded).toEqual({ hides: ['14 issues', '6 topics'], staysVisible: ['2 files also in Estiva HQ'] })
    expect(listOf(worded.hides)).toBe('14 issues and 6 topics')
  })

  it('lists with commas and one "and"', () => {
    expect(listOf([])).toBe('')
    expect(listOf(['a'])).toBe('a')
    expect(listOf(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
