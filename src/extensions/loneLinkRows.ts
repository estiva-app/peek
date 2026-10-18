/**
 * A line that is only a link to a file or a message draws as that file's row
 * while it is written, as it will once sent (SPEC §13.2; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md;
 * the approved prototype, Peek's *Widgets 2/In Peek, In the message box*).
 *
 * The reader's rule (protocol's `isOnlyReferenceLine`, `lineDrawOf`), on the
 * document: a paragraph, or a bullet or numbered line, holding one reference
 * chip and nothing but spaces. A quote line, a person and a Folder stay chips;
 * a link on words is its words. The chip's view reads the decoration put on it
 * here ({@link isRowOfDecorations}), so it draws again as the line changes
 * around it.
 */
import { Extension } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isFolderValue, valueOfReference } from '@estiva-app/protocol'

/** The chips a line can be only of: an object, a message, an app URL once it names something. */
const CHIPS = new Set(['objectMention', 'messageMention', 'reference'])

const key = new PluginKey<DecorationSet>('loneLinkRows')

/** The one chip a paragraph holds and nothing but spaces beside it, with its offset, or undefined. */
function onlyChipOf(paragraph: PmNode): { node: PmNode; offset: number } | undefined {
  let only: { node: PmNode; offset: number } | undefined
  let other = false
  paragraph.forEach((child, offset) => {
    if (other) return
    if (child.isText && !(child.text ?? '').trim()) return
    if (only || !CHIPS.has(child.type.name) || child.marks.length > 0) other = true
    else only = { node: child, offset }
  })
  return other ? undefined : only
}

/** Whether a chip's `uri` draws a row alone on its line: a file or a message, not a Folder, and one it can name. */
function drawsRow(node: PmNode): boolean {
  const uri = typeof node.attrs.uri === 'string' ? node.attrs.uri : ''
  const value = uri ? valueOfReference(uri) : undefined
  return !!value && !isFolderValue(value)
}

export function loneLinkRows(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = []
  doc.descendants((node, pos, parent) => {
    if (node.type.name !== 'paragraph') return node.type.name !== 'blockquote' && !node.type.spec.code
    // A line of its own: the document's, or a list item's first.
    if (parent && parent.type.name !== 'doc' && parent.type.name !== 'listItem') return false
    const only = onlyChipOf(node)
    if (only && drawsRow(only.node)) {
      const at = pos + 1 + only.offset
      decorations.push(Decoration.node(at, at + only.node.nodeSize, {}, { row: true }))
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/** Whether a chip's view draws its row: the decoration this extension put on it. */
export function isRowOfDecorations(decorations: readonly Decoration[] | undefined): boolean {
  return (decorations ?? []).some((decoration) => (decoration.spec as { row?: boolean }).row === true)
}

export const LoneLinkRows = Extension.create({
  name: 'loneLinkRows',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state: EditorState) => loneLinkRows(state.doc),
          apply: (tr, set, _, state) => (tr.docChanged ? loneLinkRows(state.doc) : set),
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ]
  },
})
