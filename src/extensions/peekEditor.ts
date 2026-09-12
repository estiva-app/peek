import { peekStarterKit } from './editorKit'
import { PeekMention, UrgentMention, TopicMention, FileMention, MessageMention } from './mention'
import { ResolutionBlock } from './resolution'
import { HighlightTag } from './highlight'
import { SlashCommands } from './slashCommands'

/**
 * Everything a Peek editor can do, in one list.
 *
 * **Why this file exists.** Three editors write messages — the composer
 * (`ComposeBox`) and the two edit-in-place boxes (`ConversationCard`,
 * `ThreadReplyCard`) — and each used to spell its own `extensions` array. The
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
 * `peekStarterKit` is what `composerFormats.test` and `keptSelection.test`
 * build a bare `@tiptap/core` editor from: it is the marks and nodes with no
 * React node views, no menus and no `@/api` behind it, and those tests are
 * better for it.
 *
 * What is *not* here is anything that needs a caller: the paste handler, the
 * Enter key, the placeholder and the toolbars all differ between a box that
 * sends and a box that saves. Those stay with each editor. Only the grammar
 * is shared.
 */
export const peekEditorExtensions = [
  peekStarterKit,
  PeekMention,
  UrgentMention,
  TopicMention,
  FileMention,
  MessageMention,
  ResolutionBlock,
  HighlightTag,
  SlashCommands,
]
