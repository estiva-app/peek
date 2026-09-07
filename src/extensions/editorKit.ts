import { Extension } from '@tiptap/core'
import { Link } from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'

/**
 * The one editor kit every Peek editor uses (main composer + the
 * edit-in-place editors in ConversationCard/ThreadReplyCard). Keeping it in
 * one place means the three editors can't drift apart on what formatting the
 * app supports.
 *
 * Rich-text scope: bold / italic / underline via keyboard shortcuts
 * (Ctrl+B / I / U), inline code (Ctrl+E), headline (`# ` or Ctrl+Alt+1),
 * subheading (`## ` or Ctrl+Alt+2), quotes (`> ` or Ctrl+Shift+B), and links
 * (PEE-19: the selection toolbar's Link button, an address pasted over
 * selected words, or a typed address followed by a space).
 * Everything else stays off until designed.
 *
 * Storage stays plain text, and since RIC-4 the marker dialect it serialises
 * to is **specified** (SPEC §13.2) and lives in `@estiva-app/protocol` rather
 * than in this app — so what this editor emits is what every other Estiva app
 * reads back. What is still Peek's own is the *editor*, which is the intended
 * split: the format is shared, the editor never is.
 */

/*
  Links — PEE-19. StarterKit registers Link by default, and it was on all
  along: an address pasted over selected words, pasted alone or typed became a
  link that nobody could see (no style, see index.css) and nobody could send
  (the format writer knows four marks; SPEC §13.1's `[label](url)` is PEE-25).
  What changes here is only how the mark behaves while writing.

  `inclusive: false` — a link ends where its words end. Typing right after it
  is plain text (Katerina, 2026-09-07). Tiptap's own default is
  `inclusive = autolink`, so a link swallowed whatever was typed at its end;
  StarterKit exposes no option for it, hence the extension is taken directly
  and extended, the way `@tiptap/extension-mention` already is.

  `openOnClick: false` — a click in the composer places the caret; a link is
  followed from the sent message, never from the editor. `defaultProtocol` —
  a typed `google.com` links to https, not http; the toolbar's field
  (composerFormats `normalizeHref`) completes a bare host the same way.
*/
const PeekLink = Link.extend({ inclusive: false }).configure({
  openOnClick: false,
  defaultProtocol: 'https',
})

export const peekStarterKit = Extension.create({
  name: 'peekStarterKit',
  addExtensions() {
    return [
      StarterKit.configure({
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
        // Replaced by PeekLink above, which StarterKit's options cannot express.
        link: false,
      }),
      PeekLink,
    ]
  },
})
