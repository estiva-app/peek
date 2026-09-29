import { Extension, type Editor } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { suggestionPopup } from '@estiva-app/ui/editor'
import { SLASH_MENU, filterSlashItems, type SlashItem } from '@/components/ui/SlashMenu'
import { applyFormat } from '@/lib/composerFormats'
import { insertHighlightTag } from './highlight'

/**
 * `/` as a suggestion — PEE-18.
 *
 * **Why this replaced a bespoke implementation.** The old `/` menu watched the
 * whole document and only opened when the composer's text *began* with `/`
 * (`fullText.startsWith('/') && doc.childCount === 1`), so it was unreachable
 * mid-sentence and on any line but the first — the thing Katerina hit
 * immediately. `@`, `!@` and `[` never had that problem because they were
 * always suggestion plugins, which match at the caret. This makes `/` the same
 * kind of thing as its three neighbours rather than a special case beside them.
 *
 * `allowedPrefixes` is the plugin's default (`[' ']`), so a `/` inside a word —
 * `and/or`, a path, a URL — does not open anything. `startOfLine` is false,
 * which is the whole point.
 *
 * The popup is the package's since UIG-31 (estiva-ui 0.45.0): `suggestionPopup`
 * draws `SLASH_MENU`'s rows as a `SuggestionMenu`, and reports into the one
 * open-counter every editor asks (`isSuggestionActive`), so none of the three
 * sends or saves on the Enter that chose a row.
 *
 * Three editors, not one: this shipped registered only in `ComposeBox`, so `/`
 * did nothing when you edited a sent message. It is in `peekEditor.ts` now,
 * with the six extensions it always belonged beside.
 */

/** Run the chosen row, having first removed the `/query` that summoned it. */
export function runSlashItem(editor: Editor, range: { from: number; to: number }, item: SlashItem) {
  editor.chain().focus().deleteRange(range).run()
  if (item.kind === 'format') {
    applyFormat(editor, item.id)
  } else if (item.kind === 'highlight') {
    insertHighlightTag(editor, item.type)
  } else {
    // Type the trigger so its own suggestion plugin picks it up. Deferred a
    // frame: the delete above has to land first, or the plugin sees the
    // character arrive inside a range that is still being removed.
    requestAnimationFrame(() => editor.commands.insertContent(item.input))
  }
}

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => runSlashItem(editor, range, props),
        render: suggestionPopup(SLASH_MENU),
      }),
    ]
  },
})
