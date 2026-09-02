import StarterKit from '@tiptap/starter-kit'

/**
 * The one StarterKit config every Peek editor uses (main composer + the
 * edit-in-place editors in ConversationCard/ThreadReplyCard). Keeping it in
 * one place means the three editors can't drift apart on what formatting the
 * app supports.
 *
 * Rich-text scope: bold / italic / underline via keyboard shortcuts
 * (Ctrl+B / I / U), inline code (Ctrl+E), headline (`# ` or Ctrl+Alt+1),
 * subheading (`## ` or Ctrl+Alt+2), and quotes (`> ` or Ctrl+Shift+B).
 * Everything else stays off until designed.
 *
 * Storage stays plain text, and since RIC-4 the marker dialect it serialises
 * to is **specified** (SPEC §13.2) and lives in `@estiva-app/protocol` rather
 * than in this app — so what this editor emits is what every other Estiva app
 * reads back. What is still Peek's own is the *editor*, which is the intended
 * split: the format is shared, the editor never is.
 */
export const peekStarterKit = StarterKit.configure({
  strike: false,
  // `code` is deliberately absent — StarterKit enables it by default and it is
  // in the vocabulary (SPEC §13.1). It was switched off here while nothing
  // could render a backtick; 200 of 548 published messages carry one anyway,
  // because the agents writing most of them never used this editor. Off meant
  // people could read backticks they were not allowed to type.
  //
  // `codeBlock` stays off: a fence renders in a read-only body (MessageBody),
  // but round-tripping one through this editor needs `serializeTiptapToText`
  // and `textToTiptapContent` to speak fences, which is not RIC-4's scope.
  // Until then a fence typed here survives as literal lines, which is what it
  // did before.
  codeBlock: false,
  horizontalRule: false,
  heading: { levels: [1, 2] },
  hardBreak: false,
  trailingNode: false,
})
