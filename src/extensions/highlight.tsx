import { Node, type Editor } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { HIGHLIGHT_FILL_CLASSES, HIGHLIGHT_META, HIGHLIGHT_TEXT_CLASSES, type HighlightType } from '@/api'
import { INLINE_CHIP_CLASSES } from '@estiva-app/ui'
import { cn } from '@/lib/utils'

/**
 * HighlightTag - an inline atom node inserted at the start of a message
 * to mark it as a Highlight. Renders as a colored chip. Clicking it
 * dispatches a custom event so the ComposeBox can open the type picker.
 */

function HighlightTagView({ node }: NodeViewProps) {
  const hlType = node.attrs.highlightType as HighlightType
  const meta = HIGHLIGHT_META[hlType]

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    // Dispatch custom event with the clicked element so only the owning ComposeBox responds
    window.dispatchEvent(new CustomEvent('highlight-tag-click', { detail: e.currentTarget }))
  }

  return (
    <NodeViewWrapper
      as="span"
      // The one inline chip (D67), in the highlight's own colour and weight.
      className={cn(INLINE_CHIP_CLASSES, 'font-medium cursor-pointer', HIGHLIGHT_TEXT_CLASSES[hlType])}
      // eslint-disable-next-line no-restricted-syntax -- @estiva-escape: the tag's tint is 13% of its highlight's colour, and no token holds that tint
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, transparent)` }}
      onClick={handleClick}
      contentEditable={false}
    >
      <span className={cn('size-[10px] rounded-[2px] shrink-0', HIGHLIGHT_FILL_CLASSES[hlType])} />
      <span>{meta.label}</span>
    </NodeViewWrapper>
  )
}

export const HighlightTag = Node.create({
  name: 'highlightTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      highlightType: { default: 'insight' },
    }
  },

  renderHTML({ node }) {
    return [
      'span',
      {
        'data-highlight-tag': 'true',
        'data-type': node.attrs.highlightType,
        class: cn(INLINE_CHIP_CLASSES, 'font-medium'),
      },
      node.attrs.highlightType,
    ]
  },

  parseHTML() {
    return [{ tag: 'span[data-highlight-tag]' }]
  },

  addNodeView() {
    return ReactNodeViewRenderer(HighlightTagView, { as: 'span' })
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at position 1 (right after the tag) should delete the tag
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection
        // Check if cursor is right after a highlightTag node
        if ($from.parentOffset > 0) {
          const before = $from.nodeBefore
          if (before?.type.name === 'highlightTag') {
            editor.commands.deleteRange({
              from: $from.pos - before.nodeSize,
              to: $from.pos,
            })
            return true
          }
        }
        return false
      },
    }
  },
})

/**
 * Extract highlight type from the editor doc.
 * Returns the type if a highlightTag node is present, undefined otherwise.
 */
export function extractHighlightType(editor: {
  state: { doc: { descendants: (cb: (node: { type: { name: string }; attrs: Record<string, string> }) => boolean | void) => void } }
}): HighlightType | undefined {
  let found: HighlightType | undefined
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'highlightTag') {
      found = node.attrs.highlightType as HighlightType
      return false // stop traversal
    }
  })
  return found
}

/**
 * Put a highlight tag at the head of the document, or swap the one already
 * there — moved out of `ComposeBox` (2026-09-05) so the `/` menu can insert one
 * from the suggestion plugin, where there is no React component to call into.
 *
 * The tag always sits first: it labels the whole message, not the caret.
 */
export function insertHighlightTag(editor: Editor, type: HighlightType) {
  let tagFrom = -1
  let tagTo = -1
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'highlightTag') {
      tagFrom = pos
      tagTo = pos + node.nodeSize
    }
  })

  if (tagFrom >= 0) {
    // Replace the existing tag in place, so surrounding text survives.
    editor
      .chain()
      .deleteRange({ from: tagFrom, to: tagTo })
      .insertContentAt(tagFrom, [{ type: 'highlightTag', attrs: { highlightType: type } }])
      .focus()
      .run()
    return
  }

  editor
    .chain()
    .focus()
    .insertContentAt(1, [
      { type: 'highlightTag', attrs: { highlightType: type } },
      { type: 'text', text: ' ' },
    ])
    .run()
}
