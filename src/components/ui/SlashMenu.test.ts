import { describe, it, expect } from 'vitest'
import { filterSlashSections } from '@estiva-app/ui/editor'
import { SLASH_SECTIONS } from './SlashMenu'

/**
 * The `/` menu's contents and filtering — PEE-18.
 *
 * The menu itself is the package's (CON-27) and is covered there; what is worth
 * pinning here is Peek's list and the query, because both are what somebody
 * sees when they type.
 */

const labels = (sections: ReturnType<typeof filterSlashSections>) => sections.flatMap((s) => s.commands.map((c) => c.row.label))
const filter = (q: string) => labels(filterSlashSections(SLASH_SECTIONS, q))

describe('the menu, unfiltered', () => {
  it('runs Format, then Insert — the heading Ship uses (CON-29)', () => {
    expect(SLASH_SECTIONS.map((s) => s.label)).toEqual(['Format', 'Insert'])
  })

  it('has the rows it always had, in order', () => {
    expect(filter('')).toEqual([
      'Text', 'Heading', 'Subheading', 'Quote', 'Code', 'Bulleted list', 'Numbered list',
      'Mention', 'Urgent', 'Reference', 'Resolve',
      'Insight', 'Concern', 'Conclusion', 'Question', 'Summary',
    ])
  })

  it('offers no inline marks — they belong to the selection toolbar', () => {
    expect(filter('')).not.toContain('Bold')
    expect(filter('')).not.toContain('Italic')
    expect(filter('')).not.toContain('Underline')
  })
})

describe('filterSlashSections', () => {
  it('narrows on a label prefix, across sections', () => {
    // Both are genuine matches: Quote is a format, Question a highlight.
    expect(filter('qu')).toEqual(['Quote', 'Question'])
  })

  it('reaches both lists through the id', () => {
    expect(filter('list')).toEqual(['Bulleted list', 'Numbered list'])
  })

  it('matches a highlight by type as well as label', () => {
    expect(filter('concern')).toEqual(['Concern'])
  })

  it('matches a shortcut by its description', () => {
    expect(filter('mention a person')).toEqual(['Mention'])
  })

  it('finds Reference by what `[` lists: messages, files and topics', () => {
    for (const q of ['message', 'file', 'topic']) expect(filter(q)).toEqual(['Reference'])
  })

  it('is case-insensitive', () => {
    // 'subheading' contains 'head', so both are right.
    expect(filter('HEAD')).toEqual(['Heading', 'Subheading'])
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(filter('zzzz')).toEqual([])
  })
})
