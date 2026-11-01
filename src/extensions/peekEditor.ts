import { richTextClassName } from '@estiva-app/ui'
import { peekStarterKit } from './editorKit'
import { PeekMention, UrgentMention, TopicMention, PeekReferenceTrigger, FileMention, MessageMention, ObjectMention } from './mention'

/**
 * Peek's one editor of its own: a form's prose field (`ProseField`). The
 * composer and the edit boxes are the kit's `CommentBox` since the one
 * conversation (ui 0.96); the list every Peek editor used to share,
 * `peekEditorExtensions`, and the old `/` menu it carried went with them
 * (audit D1, Katerina, 2 November).
 */
/**
 * The editable area's classes, for that editor.
 *
 * They were written out in each `editorProps.attributes.class`, where the
 * token lint cannot see a class (it reads `className`, `cn()` and a `const`
 * named `…_CLASSES`), so `text-sm leading-[1.4]` sat there unchecked: Tailwind's
 * ramp and a hand-written line height, together exactly `text-body-2` (UIG-28 R5).
 */
/*
 * The look is the package's RichText, the one a sent message is drawn with, so
 * what you type is exactly what the card shows (UIG-30, Katerina, 28 September).
 * One thing is Peek's: a line typed with Enter is a paragraph here but a line
 * break once sent (`serializeTiptapToText` joins them with one newline), so two
 * paragraphs in a row sit flush, as the lines of one paragraph do: the pull is
 * the size of RichText's gap between blocks, 8px since estiva-ui 0.64.0.
 */
export const PEEK_EDITOR_CLASSES = richTextClassName('default', 'outline-none w-full bg-transparent min-h-[20px] [&>p+p]:-mt-2')

/**
 * The same grammar for a box that writes a **description** rather than a
 * message — a form's prose field (MAN-1, RIC-13).
 *
 * Marks, blocks and the reference chips are all here, so a description reads
 * back exactly as it was typed and a prefill carrying a `nostr:` reference
 * loads as the chip it is. What is left out is what only a message means: `/`
 * (its commands resolve and highlight a *conversation*), the resolution block
 * and the highlight tag. None of those has a place in an issue's body, and a
 * menu offering them would be offering actions that cannot succeed there.
 *
 * `UrgentMention` stays although urgency means nothing in a description:
 * `textToTiptapContent` reads `!@Name` back as that node, and an editor
 * without it could not load such a prefill. Its urgency has no wire form, so
 * a person with a key is written as a plain `nostr:npub` reference anyway.
 */
export const peekProseExtensions = [
  peekStarterKit,
  PeekMention,
  UrgentMention,
  TopicMention,
  PeekReferenceTrigger,
  FileMention,
  MessageMention,
  ObjectMention,
]
