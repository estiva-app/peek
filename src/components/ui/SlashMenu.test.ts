import { describe, it, expect } from 'vitest'
import { SLASH_ITEMS, filterSlashItems } from './SlashMenu'

/**
 * The `/` menu's contents and filtering — PEE-18.
 *
 * The menu itself is driven by the suggestion plugin and is covered in
 * Storybook; what is worth pinning here is the list and the query, because both
 * are what somebody sees when they type.
 */

describe('the menu, unfiltered', () => {
  it('runs Format, then Shortcuts, then Highlights', () => {
    const kinds = SLASH_ITEMS.map((i) => i.kind)
    const firstOf = (k: (typeof kinds)[number]) => kinds.indexOf(k)
    const lastOf = (k: (typeof kinds)[number]) => kinds.lastIndexOf(k)
    expect(lastOf('format')).toBeLessThan(firstOf('shortcut'))
    expect(lastOf('shortcut')).toBeLessThan(firstOf('highlight'))
  })

  it('puts Code straight after Quote', () => {
    const labels = SLASH_ITEMS.map((i) => i.label)
    expect(labels[labels.indexOf('Quote') + 1]).toBe('Code')
  })

  it('offers no inline marks — they belong to the selection toolbar', () => {
    const labels = SLASH_ITEMS.map((i) => i.label)
    expect(labels).not.toContain('Bold')
    expect(labels).not.toContain('Italic')
    expect(labels).not.toContain('Underline')
  })
})

describe('filterSlashItems', () => {
  it('returns everything for an empty query', () => {
    expect(filterSlashItems('')).toHaveLength(SLASH_ITEMS.length)
  })

  it('narrows on a label prefix, across sections', () => {
    // Both are genuine matches: Quote is a format, Question a highlight.
    expect(filterSlashItems('qu').map((i) => i.label)).toEqual(['Quote', 'Question'])
  })

  it('reaches both lists through the id', () => {
    expect(filterSlashItems('list').map((i) => i.label)).toEqual(['Bulleted list', 'Numbered list'])
  })

  it('matches a highlight by type as well as label', () => {
    expect(filterSlashItems('concern').map((i) => i.label)).toEqual(['Concern'])
  })

  it('matches a shortcut by its description', () => {
    expect(filterSlashItems('mention a person').map((i) => i.label)).toEqual(['Mention'])
  })

  it('is case-insensitive', () => {
    // 'subheading' contains 'head', so both are right.
    expect(filterSlashItems('HEAD').map((i) => i.label)).toEqual(['Heading', 'Subheading'])
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(filterSlashItems('zzzz')).toEqual([])
  })
})
