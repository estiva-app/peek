import { useCallback, useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { KIND_BARE_FILE, type ForeignObject } from '@estiva-app/interop'
import { CardUnder, FieldLine, LinkChip, LinkRow, loadingShapeOf, type LinkState, type LoadingShape } from '@estiva-app/ui'
import { useConversationBadges } from '@/api'
import { linkedKindOf, linkStateOf } from '@/lib/linked'
import { findMessageByEventId } from '@/lib/conversationRegistry'
import { scrollToMessage, scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { filePath } from '@/lib/objectUrl'
import { writtenLinkOf } from '@/lib/referenceLink'
import { openConversation } from '@/lib/threadOpener'
import { referenceTypeWord } from '@/lib/textParsing'
import { cardShapeOf, noteCardShape, type CardShape } from '@/lib/cardShapes'
import { rememberedUnavailable } from '@/lib/unavailableCards'
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

const isModified = (event: MouseEvent) => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/**
 * A click on a link inside a message, routed as Peek routes a mention (RIC-16).
 *
 * - It is the link's, not the message's: the card underneath opens its thread
 *   on click (`data-interactive` is the card's contract for "not mine").
 * - A message lands on itself: scrolled to when its thread is open, its thread
 *   opened when its topic is, and only otherwise `/message/<id>` (INT-3).
 * - Another app's address opens in a new tab: a stranger published it into a
 *   shared relay, hence `noopener`.
 *
 * Everything else is the kit's: an address in Peek goes through its router.
 */
function LinkClicks({ block = false, children }: { block?: boolean; children: ReactNode }) {
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as Element).closest('a')
    if (!anchor || isModified(event) || anchor.getAttribute('target')) return
    const href = anchor.getAttribute('href') ?? ''
    let url: URL
    try {
      url = new URL(href, window.location.href)
    } catch {
      return
    }
    if (url.origin !== window.location.origin) {
      event.preventDefault()
      window.open(url.href, '_blank', 'noopener,noreferrer')
      return
    }
    const eventId = /^\/message\/([0-9a-f]{64})$/i.exec(url.pathname)?.[1]
    const here = eventId ? findMessageByEventId(eventId.toLowerCase()) : undefined
    if (!here) return
    if (scrollToMessage(here.id)) {
      event.preventDefault()
      return
    }
    if (here.conversationId && openConversation(here.conversationId)) {
      event.preventDefault()
      void scrollToMessageWhenReady(here.id)
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
export function MessageChip({ uri, object, urgent, preview = true, opensAt }: { uri: string; object: ForeignObject | null | undefined; urgent?: readonly string[]; /** Hovering shows its card; off in a list of previews, where a card would cover the next one. */ preview?: boolean; /** The URL it was written as: a click opens it, on a host an app declares (LTX-6), at its block (WBM-11). */ opensAt?: string }) {
  if (/^nostr:npub1/i.test(uri)) return <Reference uri={uri} urgent={urgent} />
  return (
    <LinkClicks>
      <LinkChip link={openingAt(linkStateOf(uri, object), opensAt)} preview={preview} />
    </LinkClicks>
  )
}

/** A line that is only a link to a file or a message: that file's row, where the line was. */
export function MessageRow({ uri, object, unreadable = false, opensAt }: { uri: string; object: ForeignObject | null | undefined; /** A reference that names no address or event id. */ unreadable?: boolean; /** The URL it was written as: a click opens it, on a host an app declares (LTX-6), at its block (WBM-11). */ opensAt?: string }) {
  const link: LinkState = unreadable ? { state: 'unavailable', kind: linkedKindOf(uri), noun: referenceTypeWord(uri) ?? 'Link' } : openingAt(linkStateOf(uri, object), opensAt)
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
 * `onRemove` it has the kit's ✕: always under a box, on hover under the
 * author's own sent message (`revealOnHover`). Any reader may change the file
 * from it (Decided 16 Oct), each change written and read back
 * (`useHeldCard`). Its comment count shows the dot only for a member with
 * something unread (record membership-replaces-following).
 */
export function MessageCard({ uri, resolved, compact = false, onRemove, revealOnHover = false, opensAt }: { uri: string; resolved?: ForeignObject; /** An old message's `compact` card: the file's row under the message, as it drew before the kit. */ compact?: boolean; /** ✕: takes the card off. */ onRemove?: () => void; /** The ✕ waits for hover or focus: a sent message's. */ revealOnHover?: boolean; /** The URL the body wrote for its file: a click opens it, as the file's chip would (LTX-6). */ opensAt?: string }) {
  const naddr = uri.replace(/^nostr:/i, '')
  const { object, drawn, gone, busy, error, onAct, directory } = useHeldCard(naddr, resolved, { remember: true })
  const ready = drawn && drawn !== 'loading' && !drawn.unreachable ? drawn : undefined
  /*
    The hook keys on the addresses, not the array: one file, asked once, and
    held for five minutes (OPT-5), so a topic of carded messages is not a read
    per card on every open. A Peek topic has no comments to count: it is the
    conversation itself.
  */
  const counted = ready && !compact && ready.kind !== KIND_BARE_FILE ? ready : undefined
  const { counts, unread } = useConversationBadges(counted ? [counted] : undefined, { hold: true })
  const act = useCallback((actionId: string, value: string) => {
    if (!busy) void onAct(actionId, value)
  }, [busy, onAct])

  let link: LinkState | null
  let loadingShape: CardShape | undefined
  const notAvailable: LinkState = { state: 'unavailable', kind: linkedKindOf(uri), noun: referenceTypeWord(uri) ?? 'Link' }
  if (object === 'loading') {
    // Found not available the last time this device asked: its one-line row from the first paint, not a card's height (OPT-10).
    // Otherwise a placeholder of the card's own height, so the conversation does not move as it loads.
    const kind = linkedKindOf(uri)
    loadingShape = rememberedUnavailable(naddr) || compact ? undefined : cardShapeOf(naddr, kind)
    link = rememberedUnavailable(naddr) ? notAvailable : { state: 'loading', kind, shape: loadingShape }
  } else if (object === null) {
    // Only an answer of nothing says "not available"; a failed read (a 429, the network) keeps what this device remembered.
    link = gone || rememberedUnavailable(naddr) ? notAvailable : null
  } else {
    const count = counted ? counts[counted.ref] : undefined
    const title = ready?.slots.title && !ready.slots.title.isPubkey ? ready.slots.title.value : undefined
    link = openingAt(linkStateOf(uri, drawn as ForeignObject, {
      directory,
      onAct: act,
      ...(ready?.address && count !== undefined
        ? { conversation: { count, href: filePath(ready.address, title), unread: unread[ready.ref] === true } }
        : {}),
    }), opensAt)
  }
  /*
    The drawn card's shape and height, kept for its placeholder next time. The
    height holds what the shape cannot say: a summary the kit wraps to two lines.
  */
  const shape = !compact && link?.state === 'ready' ? loadingShapeOf(link.linked) : undefined
  const shapeKey = shape && JSON.stringify(shape)
  const box = useRef<HTMLDivElement>(null)
  const kindOfCard = linkedKindOf(uri)
  useEffect(() => {
    const card = box.current?.firstElementChild
    if (!shapeKey || !card) return
    const drawn = JSON.parse(shapeKey) as LoadingShape
    // A card not on screen (a closed panel) measures 0: it keeps the height it last drew at.
    const note = () => {
      const height = Math.round(card.getBoundingClientRect().height)
      noteCardShape(naddr, height > 0 ? { ...drawn, height } : { ...drawn, height: cardShapeOf(naddr, kindOfCard)?.height })
    }
    note()
    if (typeof ResizeObserver === 'undefined') return
    // A window being resized changes every card's height each frame: note it once it settles.
    let settle: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(settle)
      settle = setTimeout(note, 500)
    })
    observer.observe(card)
    return () => {
      observer.disconnect()
      clearTimeout(settle)
    }
  }, [naddr, shapeKey, kindOfCard])
  if (!link) return null
  return (
    <LinkClicks block>
      <div ref={box} data-card={compact ? 'compact' : 'detailed'} data-card-value={naddr} style={loadingShape?.height ? { minHeight: loadingShape.height } : undefined}>
        {compact ? <LinkRow link={link} /> : <CardUnder link={link} onRemove={onRemove} revealOnHover={revealOnHover} />}
        {error && (
          <FieldLine tone="error" className="mt-1">
            {error}
          </FieldLine>
        )}
      </div>
    </LinkClicks>
  )
}
