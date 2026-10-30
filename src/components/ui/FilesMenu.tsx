import { IconMessage } from '@tabler/icons-react'
import { referenceMenu, type CaptionedItem } from '@estiva-app/ui/editor'
import { messageReference, messageWords, openingWords } from '@estiva-app/conversation'
import { knownCardValue, linksVersion, personByPubkey } from '@/api'
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
// Files first, then Messages, as `[` lists them in every app (Katerina, 30 Oct).
export const FILES_MENU_COPY = { ariaLabel: 'Files and messages', sectionLabel: 'Messages' }

/**
 * A message as `[` offers it. The caption is the author and the opening words,
 * marks stripped and an app link read as what it names once that has come
 * back, never the raw URL (Katerina, 30 Oct). It is found by its own words
 * (`messageWords`), not by the links in them, so typing a file's word finds the
 * file, not every message that links to it.
 *
 * The `uri` is what the body will carry, verbatim: `messageReference`, with
 * the kind in the pointer so a reader can fetch the manifest and the event
 * together, and no relay hint.
 */
export function toReferenceItem(message: ConversationMessage): CaptionedItem {
  // `[` asks on every keystroke, for every message on screen: each item is built once, and again only once a link's
  // answer has come back since, so a caption never keeps a raw URL that now names something.
  const version = linksVersion()
  const known = ITEMS.get(message)
  if (known && known.version === version) return known.item
  const nameOf = (pubkey: string) => personByPubkey(pubkey)?.name
  const item = {
    id: message.eventId as string,
    label: message.author,
    snippet: openingWords(message.body, nameOf, { resolveLink: knownCardValue }),
    uri: messageReference(message.eventId as string, MESSAGE_KIND),
    search: messageWords(message.body, nameOf),
  }
  ITEMS.set(message, { version, item })
  return item
}

const ITEMS = new WeakMap<ConversationMessage, { version: number; item: CaptionedItem }>()

/** At each row's start. */
export const FILES_MENU_ICON = <IconMessage size={16} stroke={1.5} className="text-text-secondary" />

/** The list `[` opens, for a story that draws it without an editor. */
export const FILES_MENU = referenceMenu({ ...FILES_MENU_COPY, icon: FILES_MENU_ICON })
