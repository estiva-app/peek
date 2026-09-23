import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * The selection, kept visible while something else has the focus — PEE-19.
 *
 * The toolbar's address field takes the focus, and with it the document's
 * one selection, so the words being linked lost their highlight the moment
 * the field opened (measured 2026-09-07). Linear keeps it, and Katerina asked
 * for the same. The editor's own selection never moved — ProseMirror keeps it
 * while unfocused — so this only *draws* it: an inline decoration over the
 * range, in the colour `::selection` paints in the composer (index.css),
 * mapped through edits and cleared when the field closes.
 *
 * A decoration rather than a second selection, because a document has one
 * and the field needs it. Editor-internal by design (the editor owns its own
 * drawing); nothing here floats, focuses or handles a key.
 */

export interface KeptRange {
  from: number
  to: number
}

export const keptSelectionKey = new PluginKey<KeptRange | null>('keptSelection')

export const KeptSelection = Extension.create({
  name: 'keptSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin<KeptRange | null>({
        key: keptSelectionKey,
        state: {
          init: () => null,
          apply(tr, previous) {
            const meta = tr.getMeta(keptSelectionKey) as KeptRange | null | undefined
            if (meta !== undefined) return meta
            if (!previous) return null
            // Follow the words through an edit, so applying the link to them
            // (or typing before them) does not leave the highlight behind.
            return { from: tr.mapping.map(previous.from), to: tr.mapping.map(previous.to) }
          },
        },
        props: {
          decorations(state) {
            const range = keptSelectionKey.getState(state)
            if (!range || range.from === range.to) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'kept-selection' }),
            ])
          },
        },
      }),
    ]
  },
})

/** Draw the selection as it is now, until `releaseSelection`. */
export function keepSelection(editor: Editor) {
  const { from, to } = editor.state.selection
  editor.view.dispatch(editor.state.tr.setMeta(keptSelectionKey, { from, to }))
}

/** Stop drawing it. Nothing kept, nothing dispatched. */
export function releaseSelection(editor: Editor) {
  if (editor.isDestroyed || !keptSelectionKey.getState(editor.state)) return
  editor.view.dispatch(editor.state.tr.setMeta(keptSelectionKey, null))
}

/** What is being drawn, or null. */
export function keptSelection(editor: Editor): KeptRange | null {
  return keptSelectionKey.getState(editor.state) ?? null
}
