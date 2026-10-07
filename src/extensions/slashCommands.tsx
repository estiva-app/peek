import { SlashCommands as SharedSlashCommands } from '@estiva-app/ui/editor'
import { EDIT_SLASH_SECTIONS, SLASH_SECTIONS } from '@/components/ui/SlashMenu'

/**
 * `/` as a suggestion — PEE-18, the package's since CON-27 (estiva-ui 0.52.0).
 *
 * **Why this replaced a bespoke implementation.** The old `/` menu watched the
 * whole document and only opened when the composer's text *began* with `/`,
 * so it was unreachable mid-sentence and on any line but the first — the thing
 * Katerina hit immediately. `@`, `!@` and `[` never had that problem because
 * they were always suggestion plugins, which match at the caret; `/` is the
 * same kind of thing as its three neighbours now. A `/` inside a word —
 * `and/or`, a path, a URL — does not open anything.
 *
 * The popup reports into the one open-counter every editor asks
 * (`isSuggestionActive`), so none of the three sends or saves on the Enter that
 * chose a row. Three editors, not one: it is in `peekEditor.ts`, with the
 * extensions it always belonged beside.
 */
export const SlashCommands = SharedSlashCommands.configure({ sections: SLASH_SECTIONS })

/** `/` in a box that edits a sent message, which offers no urgent mention (CON-24). */
export const EditSlashCommands = SharedSlashCommands.configure({ sections: EDIT_SLASH_SECTIONS })
