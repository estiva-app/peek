import { Node } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { HIGHLIGHT_FILL_CLASSES, HIGHLIGHT_META, HIGHLIGHT_TEXT_CLASSES, type HighlightType } from '@/api'
import { INLINE_CHIP_CLASSES } from '@estiva-app/ui'
import { cn } from '@/lib/utils'

/**
 * HighlightTag - an inline atom node at the start of a message that marks it
 * as a Highlight, drawn as a coloured chip. Nothing inserts one now (the
 * Highlights wait for stage 2, PEEKM-3); a draft from before still holds one,
 * and the box still sends it beside the text. Its click, the picker it opened
 * and the helpers that read and wrote it went (audit D2, 2 November).
 */

function HighlightTagView({ node }: NodeViewProps) {
  const hlType = node.attrs.highlightType as HighlightType
  const meta = HIGHLIGHT_META[hlType]

  return (
    <NodeViewWrapper
      as="span"
      // The one inline chip (D67), in the highlight's own colour and weight.
      className={cn(INLINE_CHIP_CLASSES, 'font-medium', HIGHLIGHT_TEXT_CLASSES[hlType])}
      // eslint-disable-next-line no-restricted-syntax -- @estiva-escape: the tag's tint is 13% of its highlight's colour, and no token holds that tint
      style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 13%, transparent)` }}
      contentEditable={false}
    >
      <span className={cn('size-[10px] rounded-sm shrink-0', HIGHLIGHT_FILL_CLASSES[hlType])} />
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
