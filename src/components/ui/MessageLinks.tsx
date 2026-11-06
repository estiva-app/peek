import { useCallback, type MouseEvent, type ReactNode } from 'react'
import { KIND_BARE_FILE, type ForeignObject } from '@estiva-app/interop'
import { AttachedCard, FieldLine, isPlainClick, LinkChip, LinkRow, type LinkedConversation, type LinkState } from '@estiva-app/ui'
import { formatDateLabel, useConversationBadges, useDeleted, useLinksIn } from '@/api'
import { DELETED_FIELD } from '@/lib/fileControls'
import { linkedKindOf, linkStateOf, messageWordsOf } from '@/lib/linked'
import { findMessageByEventId } from '@/lib/conversationRegistry'
import { showInConversation, showInConversationWhenDrawn } from '@estiva-app/ui'
import { filePath } from '@/lib/objectUrl'
import { writtenLinkOf } from '@/lib/referenceLink'
import { openConversation } from '@/lib/threadOpener'
import { referenceTypeWord } from '@/lib/textParsing'
import { cardShapes } from '@/lib/cardShapes'
import { rememberedUnavailable } from '@/lib/unavailableCards'
import { DeletedCard } from './DeletedCard'
import { Reference } from './Reference'
import { useHeldCard } from './useHeldCard'

/*
  A message's links, drawn by the kit (`@estiva-app/ui` 0.75): a chip in a
  sentence, a row alone on its line, the card its author chose under the
  message (why:
  https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-link-on-words-counts-toward-the-card.md).
  Peek adds what only it knows: where its own links land, and that a click on a
  link is not a click on the message around it.
*/

/**
 * A click on a link inside a message, routed as Peek routes a mention (RIC-16).
 *
 * - It is the link's, not the message's: the card underneath opens its thread
 *   on click (`data-interactive` is the card's contract for "not mine").
 * - A message lands on itself: scrolled to when its thread is open, its thread
 *   opened when its topic is, and only otherwise `/message/<id>` (INT-3).
 *
 * Everything else is the kit's: every link inside is a kit part, which sends
 * an address in Peek through its router and opens another site's in a new tab
 * that cannot reach back (`AppProvider`); a click with a modifier is the
 * browser's.
 */
function LinkClicks({ block = false, children }: { block?: boolean; children: ReactNode }) {
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as Element).closest('a')
    if (!anchor || !isPlainClick(event) || anchor.getAttribute('target')) return
    const href = anchor.getAttribute('href') ?? ''
    let url: URL
    try {
      url = new URL(href, window.location.href)
    } catch {
      return
    }
    if (url.origin !== window.location.origin) return
    const eventId = /^\/message\/([0-9a-f]{64})$/i.exec(url.pathname)?.[1]
    const here = eventId ? findMessageByEventId(eventId.toLowerCase()) : undefined
    if (!here) return
    if (showInConversation(here.id)) {
      event.preventDefault()
      return
    }
    if (here.conversationId && openConversation(here.conversationId)) {
      event.preventDefault()
      void showInConversationWhenDrawn(here.id)
    }
  }
  const props = {
    onClickCapture,
    // After the control's own handler: the message around it never hears a click on a link or a picker. The card's empty space still opens its thread.
    onClick: (event: MouseEvent) => {
      if ((event.target as Element).closest('a, button, [role="combobox"], [role="option"], [role="listbox"]')) event.stopPropagation()
    },
  }
  return block ? <div {...props}>{children}</div> : <span {...props}>{children}</span>
}

/**
 * A file's comment count, opening its conversation (its page here), on its row
 * and its card alike (Katerina, 30 Oct: the count on rows too). The dot shows
 * only for a member with something unread (record membership-replaces-following).
 * The hook keys on the address, not the object: one file, asked once and held
 * for five minutes (OPT-5), so a topic of linked files is not a read per link
 * on every open. A bare file is nobody's conversation, so it has no count.
 */
function useConversationOf(file: ForeignObject | null | undefined | 'loading'): LinkedConversation | undefined {
  const counted = file && file !== 'loading' && !file.unreachable && file.kind !== KIND_BARE_FILE ? file : undefined
  const { counts, unread } = useConversationBadges(counted ? [counted] : undefined, { hold: true })
  const count = counted ? counts[counted.ref] : undefined
  if (!counted?.address || count === undefined) return undefined
  const title = counted.slots.title && !counted.slots.title.isPubkey ? counted.slots.title.value : undefined
  return { count, href: filePath(counted.address, title), unread: unread[counted.ref] === true }
}

/** A file's link state, opening at the block a link to one block was written for (§13.6.1). */
function openingAt(link: LinkState, written: string | undefined): LinkState {
  const block = link.state === 'ready' ? writtenLinkOf(written, link.linked.href) : undefined
  return block && link.state === 'ready' ? { ...link, linked: { ...link.linked, href: block.href } } : link
}

/** A part of another file shown in a message (SPEC §13.6.1): its links are clicked as a chip's are. */
export function MessagePart({ children }: { children: ReactNode }) {
  return <LinkClicks block>{children}</LinkClicks>
}

/**
 * A reference in a sentence: the kit's chip, or a person's, which the kit has
 * no kind for. `object` is the body's one lookup (`undefined` while asked), so
 * the same file never draws in two states on one screen.
 */
export function MessageChip({ uri, object, urgent, preview = true, opensAt }: { uri: string; object: ForeignObject | null | undefined; urgent?: readonly string[]; /** Hovering shows its card; off in a list of previews, where a card would cover the next one, and when its card is under the message already. */ preview?: boolean; /** The URL it was written as: a click opens it, on a host an app declares (LTX-6), at its block (WBM-11). */ opensAt?: string }) {
  // Hooks first: a person's chip draws none of what they read.
  const deleted = useDeleted(uri, object)
  useLinksIn(messageWordsOf(object))
  if (/^nostr:npub1/i.test(uri)) return <Reference uri={uri} urgent={urgent} />
  return (
    <LinkClicks>
      <LinkChip link={openingAt(linkStateOf(uri, object, { url: opensAt, deleted }), opensAt)} preview={preview} />
    </LinkClicks>
  )
}

/** A line that is only a link to a file or a message: that file's row, where the line was. */
export function MessageRow({ uri, object, unreadable = false, opensAt }: { uri: string; object: ForeignObject | null | undefined; /** A reference that names no address or event id. */ unreadable?: boolean; /** The URL it was written as: a click opens it, on a host an app declares (LTX-6), at its block (WBM-11). */ opensAt?: string }) {
  const conversation = useConversationOf(unreadable ? undefined : object)
  const deleted = useDeleted(uri, unreadable ? undefined : object)
  useLinksIn(messageWordsOf(object))
  const link: LinkState = unreadable
    ? { state: 'unavailable', kind: linkedKindOf(uri), noun: referenceTypeWord(uri) ?? 'Link' }
    : openingAt(linkStateOf(uri, object, { url: opensAt, deleted, ...(conversation ? { conversation } : {}) }), opensAt)
  return (
    <LinkClicks block>
      <div data-link-row>
        <LinkRow link={link} />
      </div>
    </LinkClicks>
  )
}

/**
 * The card under a message (SPEC §13.6.2), or under the box writing one. With
 * `onRemove` it has the kit's ✕, the round one a file has, shown on hover or
 * focus (always on a screen that cannot hover). Any reader may change the file
 * from it (Decided 16 Oct), each change written and read back
 * (`useHeldCard`), except where the reader cannot act: then its values read as
 * words (`readOnly`; Katerina, 30 Oct). Its comment count shows the dot only
 * for a member with something unread (record membership-replaces-following).
 */
export function MessageCard({ uri, resolved, compact = false, readOnly = false, onRemove, opensAt }: { uri: string; resolved?: ForeignObject; /** An old message's `compact` card: the file's row under the message, as it drew before the kit. */ compact?: boolean; /** Its values as words, never pickers: the conversation it is in is archived or read-only. */ readOnly?: boolean; /** ✕: takes the card off. */ onRemove?: () => void; /** The URL the body wrote for its file: a click opens it, as the file's chip would (LTX-6). */ opensAt?: string }) {
  const naddr = uri.replace(/^nostr:/i, '')
  const { object, drawn, busy, error, onAct, directory } = useHeldCard(naddr, resolved, { remember: true, card: !compact })
  const ready = drawn && drawn !== 'loading' && !drawn.unreachable ? drawn : undefined
  const conversation = useConversationOf(ready)
  // A file that came back as nothing: deleted, when a deletion the protocol trusts names it (SPEC §13.6.1).
  const deleted = useDeleted(uri, object === 'loading' ? undefined : object)
  useLinksIn(messageWordsOf(ready))
  const act = useCallback((actionId: string, value: string) => {
    if (!busy) void onAct(actionId, value)
  }, [busy, onAct])

  /*
    Deleted (SPEC §6.5, ALO-6): its title, who deleted it and when, and Restore — the action that deleted it, with the
    empty value — for someone who may change it from here. Read the same with the switch on or off: interop folds
    `deleted` either way.
  */
  if (ready?.deleted) {
    const restore = readOnly ? undefined : ready.actions.find((action) => action.field === DELETED_FIELD)
    return (
      <div data-card={compact ? 'compact' : 'detailed'} data-card-value={naddr}>
        <DeletedCard
          title={ready.slots.title?.value || 'Untitled'}
          noun={referenceTypeWord(uri) ?? ready.noun ?? 'File'}
          // A dash for a person nobody has named, as the kit's Person draws one: never their key.
          by={ready.people?.[ready.deleted.by]?.displayName ?? directory?.[ready.deleted.by]?.displayName ?? '—'}
          when={formatDateLabel(ready.deleted.at * 1000)}
          onRestore={restore ? () => onAct(restore.id, '') : undefined}
        />
        {error && (
          <FieldLine tone="error" className="mt-1">
            {error}
          </FieldLine>
        )}
      </div>
    )
  }

  let link: LinkState
  // Not this reader's to see, or deleted, or, when the body wrote a URL, that URL as written (SPEC §13.1, C21).
  const notAvailable = linkStateOf(uri, null, { url: opensAt, deleted })
  if (object === 'loading') {
    // Found not available the last time this device asked: its one-line row from the first paint, not a card's height (OPT-10).
    // Otherwise the kit holds the card's own height and shape from the last time (`remember`), so the conversation does not move as it loads.
    link = rememberedUnavailable(naddr) ? notAvailable : { state: 'loading', kind: linkedKindOf(uri) }
  } else if (object === null) {
    // An answer of nothing, or a read that failed (a busy relay, the network): "not available", never a blank where the
    // card was (Katerina, 30 Oct). A failed read is asked again quietly (`useHeldObject`) and the card draws once it is
    // answered; only an answer of nothing is remembered on this device (`useHeldCard`).
    link = notAvailable
  } else {
    // Without `onAct` the kit draws the values as words.
    link = openingAt(linkStateOf(uri, drawn as ForeignObject, { directory, ...(readOnly ? {} : { onAct: act }), ...(conversation ? { conversation } : {}) }), opensAt)
  }
  return (
    <LinkClicks block>
      <div data-card={compact ? 'compact' : 'detailed'} data-card-value={naddr}>
        {/* The kit measures the drawn card and keeps its shape and height for its placeholder next time (C4). */}
        {compact ? <LinkRow link={link} /> : <AttachedCard link={link} onRemove={onRemove} remember={{ memory: cardShapes, id: naddr }} />}
        {error && (
          <FieldLine tone="error" className="mt-1">
            {error}
          </FieldLine>
        )}
      </div>
    </LinkClicks>
  )
}
