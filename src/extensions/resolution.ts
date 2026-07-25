import { Node, InputRule } from '@tiptap/core'

/**
 * ResolutionBlock - a block node triggered by typing "-> " at the start of a paragraph.
 * Renders with a left border in the editor. On send, the text is extracted as a resolution
 * message and stripped from the visible message body.
 */
export const ResolutionBlock = Node.create({
  name: 'resolutionBlock',
  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'div[data-resolution]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, 'data-resolution': 'true', style: 'border-left: 3px solid var(--success-default); padding-left: 8px;' }, 0]
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^->\s$/,
        handler: ({ state, range, commands }) => {
          const blockType = state.schema.nodes.resolutionBlock
          if (!blockType) return

          // Delete the "-> " trigger text
          commands.deleteRange({ from: range.from, to: range.to })
          // Convert the now-empty paragraph to a resolutionBlock
          commands.setNode('resolutionBlock')
          // Insert the → arrow prefix
          commands.insertContent('→ ')
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      // Backspace on empty resolution block: convert back to paragraph
      Backspace: ({ editor }) => {
        const { state } = editor
        const { $from } = state.selection
        const node = $from.parent
        if (node.type.name !== 'resolutionBlock') return false
        if (node.textContent.length === 0 && $from.parentOffset === 0) {
          editor.commands.setNode('paragraph')
          return true
        }
        return false
      },
    }
  },
})

/** Sentinel words that mean "resolve with no message" */
const EMPTY_SENTINELS = new Set(['', 'done', 'resolve', 'resolved'])

/**
 * Extract resolution info from a Tiptap editor doc.
 * Returns { hasResolution, resolutionMessage } where resolutionMessage is empty
 * if the text was a sentinel like "done" or "resolve".
 */
export function extractResolution(editor: { state: { doc: { forEach: (cb: (node: { type: { name: string }; textContent: string }) => void) => void } } }): {
  hasResolution: boolean
  resolutionMessage: string
} {
  let hasResolution = false
  let resolutionMessage = ''

  editor.state.doc.forEach((node) => {
    if (node.type.name === 'resolutionBlock') {
      hasResolution = true
      const raw = node.textContent.trim()
      // Strip the → prefix inserted by the input rule
      const text = raw.replace(/^→\s*/, '').trim()
      if (!EMPTY_SENTINELS.has(text.toLowerCase())) {
        resolutionMessage = text
      }
    }
  })

  return { hasResolution, resolutionMessage }
}

/**
 * Fallback for the edit-message flow: if the user typed "-> something" but the
 * Tiptap InputRule never converted it to a resolutionBlock (e.g. they pasted,
 * or pressed Enter before the trigger fired), find that pattern in the
 * serialized text and extract the message + body without it.
 *
 * ONLY a line that starts with "-> " / "→ " counts — mirroring the composer,
 * where the trigger fires at the start of an empty paragraph. Arrows
 * mid-sentence ("a -> b") or inside list items ("- x -> y") are prose and
 * stay in the body untouched (bug 2026-07-23: the old mid-line match ate the
 * first " -> " anywhere in the message and silently resolved the thread).
 */
export function extractResolutionFromText(body: string): {
  body: string
  resolutionMessage: string
} | null {
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const startMatch = lines[i].match(/^(?:->|→)\s+(.+)$/)
    if (startMatch) {
      const message = startMatch[1].trim()
      const remaining = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim()
      return {
        body: remaining,
        resolutionMessage: EMPTY_SENTINELS.has(message.toLowerCase()) ? '' : message,
      }
    }
  }
  return null
}
