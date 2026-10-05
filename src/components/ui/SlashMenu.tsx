import { EnterHint } from '@estiva-app/ui'
import { formatSection, typeTrigger, type SlashCommand, type SlashSection } from '@estiva-app/ui/editor'
import { HighlightSwatch } from './HighlightPill'
import { insertHighlightTag } from '@/extensions/highlight'
import type { HighlightType } from '@/api'

/**
 * The `/` menu — PEE-18: which rows Peek adds beside the shared Format section.
 *
 * The list, the trigger and the Format section are the package's since CON-27
 * (estiva-ui 0.52.0, `SlashCommands` and `formatSection`); code stays inline
 * here (Katerina, 29 Sep). What is left is only Peek's: its own rows, and how
 * each looks.
 *
 * Format, then Peek's rows under **Insert** — the one heading every app's own
 * section takes, as Ship's does (Miky, CON-25 kickoff, 2026-10-02; CON-29).
 * Inside it the order is Katerina's of 2026-09-04: the triggers, then the
 * Highlights.
 */

function shortcut(label: string, trigger: string, input: string, description: string): SlashCommand {
  // The hint is the trigger this app teaches, matching the Format section rather than a column of chords.
  return { key: `shortcut-${trigger}`, row: { label, shortcut: trigger }, keywords: [trigger, input, description], run: typeTrigger(input) }
}

function highlight(type: HighlightType, label: string): SlashCommand {
  return {
    key: `highlight-${type}`,
    row: { label, leading: <HighlightSwatch type={type} />, hint: <EnterHint /> },
    keywords: [type],
    run: (editor) => insertHighlightTag(editor, type),
  }
}

export const SLASH_SECTIONS: readonly SlashSection[] = [
  formatSection('inline'),
  {
    label: 'Insert',
    commands: [
      shortcut('Mention', '@', '@', 'Mention a person'),
      shortcut('Urgent', '!@', '!@', 'Urgent mention'),
      // What `[` lists since PEE-21: the messages on screen first, then files and topics.
      shortcut('Reference', '[', '[', 'Reference a message, file or topic'),
      // `->`, not `→`: the row shows what you would type, and the resolution
      // block's own input rule is /^->\s$/ — there is no `→` key to press. It
      // also keeps the chip on the grid, since Geist Mono draws `→` 10px wide
      // against 6px for everything else.
      shortcut('Resolve', '->', '-> ', 'Resolve conversation'),
      highlight('insight', 'Insight'),
      highlight('concern', 'Concern'),
      highlight('conclusion', 'Conclusion'),
      highlight('question', 'Question'),
      highlight('summary', 'Summary'),
    ],
  },
]
