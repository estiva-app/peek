import StarterKit from '@tiptap/starter-kit'

/**
 * The one StarterKit config every Peek editor uses (main composer + the
 * edit-in-place editors in ConversationCard/ThreadReplyCard). Keeping it in
 * one place means the three editors can't drift apart on what formatting the
 * app supports.
 *
 * Rich-text scope (2026-07): bold / italic / underline via keyboard
 * shortcuts (Ctrl+B / I / U), headline (`# ` or Ctrl+Alt+1), subheading
 * (`## ` or Ctrl+Alt+2), and quotes (`> ` or Ctrl+Shift+B). Storage stays
 * plain text — marks serialize to `**`/`*`/`__` markers, headings to
 * `#`-prefixed lines, quote lines to `> ` prefixes (see lib/textParsing.ts).
 * Everything else stays off until designed.
 */
export const peekStarterKit = StarterKit.configure({
  strike: false,
  code: false,
  codeBlock: false,
  horizontalRule: false,
  heading: { levels: [1, 2] },
  hardBreak: false,
  trailingNode: false,
})
