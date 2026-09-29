import { EnterHint } from '@estiva-app/ui'
import type { SuggestionPopupOptions } from '@estiva-app/ui/editor'
import { HighlightSwatch } from './HighlightPill'
import { FORMATS, type FormatId } from '@/lib/composerFormats'
import type { HighlightType } from '@/api'

/**
 * The `/` menu — PEE-18: which rows it has, and what each shows.
 *
 * The list itself — the box at the caret, the keys, the highlight, the
 * scrolling, what a screen reader is told — is the package's `SuggestionMenu`
 * since UIG-31 (estiva-ui 0.45.0), drawn by `suggestionPopup` in
 * `slashCommands.tsx`. What is left here is only Peek's: the rows, their
 * sections and how each looks.
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

/** Which section a row sits in, and what it shows — the list is drawn by the package (UIG-31). */
export const SLASH_MENU: SuggestionPopupOptions<SlashItem> = {
  ariaLabel: 'Commands',
  // The box's width and the 400px cap the menu has always had (D47).
  width: 'w-[300px]',
  maxHeight: 'max-h-[400px]',
  sections: (items) => [
    { label: 'Format', items: items.filter((i) => i.kind === 'format') },
    { label: 'Shortcuts', items: items.filter((i) => i.kind === 'shortcut') },
    { label: 'Highlights', items: items.filter((i) => i.kind === 'highlight') },
  ],
  itemKey: (item) => (item.kind === 'format' ? `format-${item.id}` : item.kind === 'shortcut' ? `shortcut-${item.trigger}` : `highlight-${item.type}`),
  row: (item) =>
    item.kind === 'highlight'
      ? { label: item.label, leading: <HighlightSwatch type={item.type} />, hint: <EnterHint /> }
      : // The hint is the trigger this app teaches (`#` for a heading), not a chord.
        { label: item.label, shortcut: item.trigger },
}
