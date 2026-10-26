import { formatSection, typeTrigger, type SlashCommand, type SlashSection } from '@estiva-app/ui/editor'

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
 * Inside it the order is Katerina's of 2026-09-04: the triggers, then Resolve.
 *
 * The Highlights are not offered (Miky, 2026-10-26, PEEKM-3): a highlight has
 * no place on the relay yet, so a send dropped it and the message arrived
 * plain. They come back when stage 2 ("One conversation in every app") gives
 * a highlight its shape.
 */

function shortcut(label: string, trigger: string, input: string, description: string): SlashCommand {
  // The hint is the trigger this app teaches, matching the Format section rather than a column of chords.
  return { key: `shortcut-${trigger}`, row: { label, shortcut: trigger }, keywords: [trigger, input, description], run: typeTrigger(input) }
}

/** Peek's own Insert row, after the triggers: Resolve. The comment box puts it after the kit's. */
export const PEEK_INSERT_ROWS: readonly SlashCommand[] = [
  // `->`, not `→`: the row shows what you would type, and the resolution
  // block's own input rule is /^->\s$/ — there is no `→` key to press. It
  // also keeps the chip on the grid, since Geist Mono draws `→` 10px wide
  // against 6px for everything else.
  {
    ...shortcut('Resolve', '->', '-> ', 'Resolve conversation'),
    // Typed with the input rules on, as a person's `-> ` is: `typeTrigger` inserts without them, so the row left
    // plain `-> ` text and sent an ordinary message (PEEKM-3, on production).
    run: (editor) => {
      requestAnimationFrame(() => editor.commands.insertContent('-> ', { applyInputRules: true }))
    },
  },
]

export const SLASH_SECTIONS: readonly SlashSection[] = [
  formatSection('inline'),
  {
    label: 'Insert',
    commands: [
      shortcut('Mention', '@', '@', 'Mention a person'),
      shortcut('Urgent', '!@', '!@', 'Urgent mention'),
      // What `[` lists since PEE-21: the messages on screen first, then files and topics.
      shortcut('Reference', '[', '[', 'Reference a message, file or topic'),
      ...PEEK_INSERT_ROWS,
    ],
  },
]
