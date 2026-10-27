import { IconMessage } from '@tabler/icons-react'
import { referenceMenu, type CaptionedItem } from '@estiva-app/ui/editor'
import { messageReference, openingWords } from '@estiva-app/conversation'
import { personByPubkey } from '@/api'
import { MESSAGE_KIND } from '@/nostr/manifest'
import type { ConversationMessage } from '@/lib/conversationRegistry'

/**
 * The picker `[` opens: the messages on screen (RIC-11). Topics were its other
 * section until FOL-23 removed the Convex topics.
 *
 * The trigger, the list and the chip are the package's since CON-27 (estiva-ui
 * 0.52.0, `ReferenceTrigger`); what stays here is Peek's: the copy, and a
 * message as the package's item. A message is a file in the sense that matters
 * here (Miky, 2026-09-02: *"everything you mention … is basically a file"*),
 * and it is offered from the same key.
 */
export const FILES_MENU_COPY = { ariaLabel: 'Messages and files', sectionLabel: 'Messages' }

/**
 * A message as `[` offers it. The caption is the author and the opening words,
 * marks stripped — the same the chip wears once picked, so nothing changes
 * shape. The query is matched against the whole body, as it always was.
 *
 * The `uri` is what the body will carry, verbatim: `messageReference`, with
 * the kind in the pointer so a reader can fetch the manifest and the event
 * together, and no relay hint.
 */
export function toReferenceItem(message: ConversationMessage): CaptionedItem {
  // `[` asks on every keystroke, for every message on screen; a message's item
  // never changes, so each is built once.
  const known = ITEMS.get(message)
  if (known) return known
  const item = {
    id: message.eventId as string,
    label: message.author,
    snippet: openingWords(message.body, (pubkey) => personByPubkey(pubkey)?.name),
    uri: messageReference(message.eventId as string, MESSAGE_KIND),
    search: message.body,
  }
  ITEMS.set(message, item)
  return item
}

const ITEMS = new WeakMap<ConversationMessage, CaptionedItem>()

/** At each row's start. */
export const FILES_MENU_ICON = <IconMessage size={16} stroke={1.5} className="text-text-secondary" />

/** The list `[` opens, for a story that draws it without an editor. */
export const FILES_MENU = referenceMenu({ ...FILES_MENU_COPY, icon: FILES_MENU_ICON })
