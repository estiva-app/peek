import { richTextClassName } from '@estiva-app/ui'
import { peekStarterKit } from './editorKit'
import { PeekMention, UrgentMention, EditUrgentMention, TopicMention, PeekReferenceTrigger, FileMention, MessageMention, ObjectMention } from './mention'
import { ResolutionBlock } from './resolution'
import { HighlightTag } from './highlight'
import { EditSlashCommands, SlashCommands } from './slashCommands'

/**
 * Everything a Peek editor can do, in one list.
 *
 * **Why this file exists.** Three editors write messages — the composer
 * (`ComposeBox`) and the two edit-in-place boxes (`ConversationCard`,
 * `ReplyCard`) — and each used to spell its own `extensions` array. The
 * three arrays were the same seven entries, so nothing looked wrong, and then
 * `SlashCommands` was added to one of them. `/` worked in the composer and did
 * nothing when you edited a sent message, for months, because a list written
 * out three times is three lists.
 *
 * `editorKit.ts` was already the answer to this for marks and nodes, and its
 * own comment claims the three editors "can't drift apart on what formatting
 * the app supports" — true, and formatting was never the half that drifted.
 * The suggestion extensions sat outside it. They are in here now, so the next
 * thing added to the composer's grammar reaches the edit boxes by default
 * rather than by somebody remembering.
 *
 * The list stays here rather than inside `peekStarterKit` because
 * `peekStarterKit` is what `composerFormats.test` builds a bare
 * `@tiptap/core` editor from: it is the marks and nodes with no React node
 * views, no menus and no `@/api` behind it, and that test is better for it.
 *
 * What is *not* here is anything that needs a caller: the paste handler, the
 * Enter key, the placeholder and the toolbars all differ between a box that
 * sends and a box that saves. Those stay with each editor. Only the grammar
 * is shared.
 */
/**
 * The editable area's classes, for the same three editors.
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
 * paragraphs in a row sit flush, as the lines of one paragraph do.
 */
export const PEEK_EDITOR_CLASSES = richTextClassName('default', 'outline-none w-full bg-transparent min-h-[20px] [&>p+p]:-mt-1')

export const peekEditorExtensions = [
  peekStarterKit,
  PeekMention,
  UrgentMention,
  TopicMention,
  PeekReferenceTrigger,
  FileMention,
  MessageMention,
  ObjectMention,
  ResolutionBlock,
  HighlightTag,
  SlashCommands,
]

/**
 * The grammar of the two boxes that edit a sent message (`ConversationCard`,
 * `ReplyCard`). The same list, with one difference: urgency. An edit
 * (kind:40003) carries no tags, so the urgent chips the message was sent with
 * load and stay urgent, and neither `!@` nor `/` offers a new one (Miky,
 * CON-24 kickoff, 2026-10-07).
 */
export const peekEditExtensions = peekEditorExtensions.map((extension) =>
  extension === UrgentMention ? EditUrgentMention : extension === SlashCommands ? EditSlashCommands : extension,
)

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
