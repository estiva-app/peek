import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useState } from 'react'
import { EnterHint, MenuItem, MenuSection, MenuSeparator } from '@estiva-app/ui'
import { HighlightSwatch } from './HighlightPill'
import { FORMATS, type FormatId } from '@/lib/composerFormats'
import type { HighlightType } from '@/api'

/**
 * The `/` menu — PEE-18.
 *
 * Extracted out of `ComposeBox` (2026-09-05) when `/` moved onto the suggestion
 * plugin, so it is now built exactly like `MentionMenu` and `FilesMenu`: it owns
 * its selection, exposes `onKeyDown` through a ref for the plugin to drive, and
 * scrolls the highlighted row into view — the last of which the old inline
 * version never did, which is why the arrows looked dead once the list outgrew
 * its panel.
 *
 * Order (Katerina, 2026-09-04): Format, then Shortcuts, then Highlights.
 */

export type SlashItem =
  | { kind: 'format'; id: FormatId; label: string; trigger?: string }
  | { kind: 'shortcut'; label: string; trigger: string; input: string; description: string }
  | { kind: 'highlight'; type: HighlightType; label: string }

export const SLASH_ITEMS: SlashItem[] = [
  // The formats, their labels and their triggers live in one place
  // (src/lib/composerFormats.ts) so the menu cannot drift from what the editor
  // actually does. The hint is the trigger this app teaches (`#` for a
  // heading), matching the Shortcuts section rather than a column of chords.
  ...FORMATS.map((f): SlashItem => ({ kind: 'format', id: f.id, label: f.label, trigger: f.trigger })),
  { kind: 'shortcut', label: 'Mention', trigger: '@', input: '@', description: 'Mention a person' },
  { kind: 'shortcut', label: 'Urgent', trigger: '!@', input: '!@', description: 'Urgent mention' },
  { kind: 'shortcut', label: 'Reference', trigger: '[', input: '[', description: 'Reference a file or topic' },
  // `->`, not `→`: the row shows what you would type, and the resolution
  // block's own input rule is /^->\s$/ — there is no `→` key to press. It
  // also keeps the chip on the grid, since Geist Mono draws `→` 10px wide
  // against 6px for everything else.
  { kind: 'shortcut', label: 'Resolve', trigger: '->', input: '-> ', description: 'Resolve conversation' },
  { kind: 'highlight', type: 'insight', label: 'Insight' },
  { kind: 'highlight', type: 'concern', label: 'Concern' },
  { kind: 'highlight', type: 'conclusion', label: 'Conclusion' },
  { kind: 'highlight', type: 'question', label: 'Question' },
  { kind: 'highlight', type: 'summary', label: 'Summary' },
]

/** Narrow the list to a query — the text typed after the `/`. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter((item) => {
    if (item.kind === 'format') return item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    if (item.kind === 'highlight') return item.label.toLowerCase().includes(q) || item.type.includes(q)
    return (
      item.label.toLowerCase().includes(q) ||
      item.trigger.includes(q) ||
      item.input.includes(q) ||
      item.description.toLowerCase().includes(q)
    )
  })
}

export interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export const SlashMenu = forwardRef<SlashMenuRef, {
  items: SlashItem[]
  onSelect: (item: SlashItem) => void
}>(({ items, onSelect }, ref) => {
  const [highlight, setHighlight] = useState(0)

  // A new query is a new list; the old index may not exist in it.
  useEffect(() => setHighlight(0), [items])

  const scrollRef = useCallback((el: HTMLElement | null) => {
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  useImperativeHandle(ref, () => ({
    // @estiva-escape: the editor hands its arrow keys to this list; Base UI's lists need a text field of their own, and the editor is not one (D47, UIG-8; one shared part later, UIG-31)
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') {
        setHighlight((h) => (items.length ? (h + 1) % items.length : 0))
        return true
      }
      if (event.key === 'ArrowUp') {
        setHighlight((h) => (items.length ? (h - 1 + items.length) % items.length : 0))
        return true
      }
      if (event.key === 'Enter') {
        const item = items[highlight]
        if (item) onSelect(item)
        return true
      }
      return false
    },
  }), [items, highlight, onSelect])

  const base = useId()

  if (items.length === 0) return null

  const formats = items.filter((i): i is SlashItem & { kind: 'format' } => i.kind === 'format')
  const shortcuts = items.filter((i): i is SlashItem & { kind: 'shortcut' } => i.kind === 'shortcut')
  const highlights = items.filter((i): i is SlashItem & { kind: 'highlight' } => i.kind === 'highlight')

  const row = (item: SlashItem, key: string, extra: Partial<Parameters<typeof MenuItem>[0]> = {}) => {
    const index = items.indexOf(item)
    const selected = index === highlight
    /* A row is an `option` in the popup's listbox (P28): an id for the
       editor's `aria-activedescendant`, `aria-selected` on the highlighted
       one, and no Tab stop because focus stays in the text. */
    return (
      // @estiva-escape: a row of a list the editor drives from its caret; Base UI's lists need a text field of their own, and the editor is not one (D47, UIG-8; one shared part later, UIG-31)
      <MenuItem
        key={key}
        role="option"
        id={`${base}-${index}`}
        aria-selected={selected}
        tabIndex={-1}
        ref={selected ? scrollRef : undefined}
        label={item.label}
        selected={selected}
        onMouseEnter={() => setHighlight(index)}
        onMouseDown={(e) => {
          e.preventDefault()
          onSelect(item)
        }}
        {...extra}
      />
    )
  }

  return (
    <div className="flex flex-col">
      {formats.length > 0 && (
        <div role="group" aria-label="Format">
        <MenuSection label="Format">
          {formats.map((item) => row(item, item.id, { shortcut: item.trigger }))}
        </MenuSection>
        </div>
      )}
      {formats.length > 0 && shortcuts.length > 0 && <MenuSeparator />}
      {shortcuts.length > 0 && (
        <div role="group" aria-label="Shortcuts">
        <MenuSection label="Shortcuts">
          {shortcuts.map((item) => row(item, item.trigger, { shortcut: item.trigger }))}
        </MenuSection>
        </div>
      )}
      {shortcuts.length > 0 && highlights.length > 0 && <MenuSeparator />}
      {highlights.length > 0 && (
        <div role="group" aria-label="Highlights">
        <MenuSection label="Highlights">
          {highlights.map((item) =>
            row(item, item.type, {
              leading: <HighlightSwatch type={item.type} />,
              hint: <EnterHint />,
            }),
          )}
        </MenuSection>
        </div>
      )}
    </div>
  )
})
SlashMenu.displayName = 'SlashMenu'
