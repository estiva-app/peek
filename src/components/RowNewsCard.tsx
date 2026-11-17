import { useNavigate } from 'react-router-dom'
import { ActivityLine, Button, MenuSection, isPlainClick } from '@estiva-app/ui'
import { IconArrowBackUp, IconAt, IconMessage, IconMoodSmile } from '@tabler/icons-react'
import type { UnreadReason } from '@estiva-app/conversation'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { CARD_LINES, formatActive, newestFirst, useListedFill, useListedFillOf, type RowNewsItem } from '@/api'
import { useNewsLineDetails } from '@/components/newsLineDetails'
import { filePath } from '@/lib/objectUrl'
import { previewText } from '@/lib/textParsing'

/** What a line says someone did: the shared rule's reason (SPEC §11.8 *Why a message is unread*), in Peek's words. */
const VERB: Record<UnreadReason, string> = {
  mention: 'mentioned you',
  'new-conversation': 'started a conversation',
  'reply-in-yours': 'replied in your conversation',
  message: 'wrote',
}

const MARK_ICON = { size: 16, stroke: 1.5, 'aria-hidden': true } as const
/**
 * What kind of thing a line is, beside its first line (the navigation prototype's marks, Katerina, 6 and 16 November):
 * a mention in the accent, a reply, a new conversation or a message, a reaction to you — in the dot's orange while it
 * is new (ACT-7: the 6px disc that said so before).
 */
function markOf(item: RowNewsItem, seen: boolean): ReactNode {
  if (item.reaction) return <IconMoodSmile {...MARK_ICON} className={seen ? undefined : 'text-warning-default'} />
  if (item.reason === 'mention') return <IconAt {...MARK_ICON} className="text-accent-text" />
  if (item.reason === 'reply-in-yours') return <IconArrowBackUp {...MARK_ICON} />
  return <IconMessage {...MARK_ICON} />
}

/**
 * What a reaction line says someone did (ACT-7): "reacted 👍 to your message". The file it is on is named where every
 * line names it, in the place line.
 *
 * A reaction's content is whatever its sender typed: only a single emoji is drawn, so nobody can put their words in
 * Peek's sentence ("reacted — your session expired, sign in at …"). `+` or nothing is a like, 👍; anything else says
 * only that they reacted.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-names-whose-message-it-reacts-to.md
 */
function reactedWords(content: string): string {
  const emoji = content === '' || content === '+' ? '👍' : oneEmoji(content) ? content : undefined
  return emoji ? `reacted ${emoji} to your message` : 'reacted to your message'
}

/** One emoji: a single grapheme, a pictograph with only its presentation, skin-tone and joiner marks, or a flag. */
function oneEmoji(text: string): boolean {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return false
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)]
  if (graphemes.length !== 1) return false
  if (/^\p{Regional_Indicator}{2}$/u.test(text)) return true
  return /\p{Extended_Pictographic}/u.test(text) && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|⃣|[\u{e0020}-\u{e007f}])+$/u.test(text)
}

/**
 * The card on a lit row in Topics, Teams or People (ACT-3; the activity indicator prototype Miky approved on 10
 * November): what is new there, newest first — who, what, on which file, the words and when. At most five lines;
 * more than that ends with "N more", which opens the place. A line opens where it was said: a topic's message or a
 * listed file's comment at its thread, a team chat's or a DM's in the place. Only what is new (Miky, 10 November):
 * the row's dot and this card are one list.
 */
export function RowNewsCard({ items: held, fileRef, placeHref, place, onOpen, openHere }: {
  items: readonly RowNewsItem[]
  /** A topic's row: its listed files' other new comments are read while the card is open (383a4d3b). */
  fileRef?: string
  /** The row's own link: where "N more" goes, and where a line with no file opens. */
  placeHref: string
  /** A topic or space (its lines open at their thread), a team's chat, or a DM (its lines open the DM). */
  place: 'topic' | 'chat' | 'dm'
  /** What the row's own click does before its page opens (a topic row keeps its column beside it): `file` is a line's listed file, else none. */
  onOpen?: (file: string | undefined) => void
  /**
   * A plain click opens the line where the row's own click does, not at its page: the Desk's panel (ACT-9). `undefined`
   * is "N more", the row's place. A click with a modifier is still the link's: a new tab.
   */
  openHere?: (item: RowNewsItem | undefined) => void
}) {
  const navigate = useNavigate()
  // The column holds only each listed file's newest comment from before the page opened: the rest, read now.
  const filled = useListedFill(useListedFillOf(fileRef ?? ''))
  const items = useMemo(() => (filled?.length ? newestFirst(held, filled) : held), [held, filled])
  const details = useNewsLineDetails(items)
  const shown = items.slice(0, CARD_LINES)
  const more = items.length - shown.length
  // Every line opens at its thread (`?thread=`, read by FilePage, TeamChat and the DM view), except a team chat's or a
  // DM's message that answers nothing: that one is in the place itself, at the bottom, where it opens.
  const thread = (item: RowNewsItem) => `?thread=${encodeURIComponent(item.root)}`
  // A reaction opens where the message it reacts to was said (ACT-7).
  const hrefOf = (item: RowNewsItem) =>
    item.file
      ? `${filePath(item.file)}${thread(item)}`
      : place === 'topic' || item.root !== (item.reaction?.target ?? item.id)
        ? `${placeHref}${thread(item)}`
        : placeHref
  /*
    As the navigation prototype draws a lit row's card (Katerina, 17 November): "New" over the lines, the kit's
    MenuSection as the title dot's list heads them (its heading in the kit's secondary text, the quieter one), and the
    lines' box 4px in from the card's own 4px on every side, so a line's background sits 8px from the card's edges.
  */
  return (
    <div className="p-1">
      <MenuSection label="New">
      {shown.map((item) => (
        <NewsLine
          key={item.id}
          item={item}
          details={details}
          href={hrefOf(item)}
          onClick={(event) => {
            if (openHere && isPlainClick(event)) {
              event.preventDefault()
              openHere(item)
              return
            }
            onOpen?.(item.file)
          }}
        />
      ))}
      {more > 0 && (
        <Button variant="muted" size="small" onClick={() => {
            if (openHere) return openHere(undefined)
            onOpen?.(undefined)
            navigate(placeHref)
          }} className="self-start">
          {`${more} more`}
        </Button>
      )}
      </MenuSection>
    </div>
  )
}

/**
 * One line, as a lit row's card and a page's list both draw it: who, why, when, then where (a place on a team's list,
 * a listed file) and the words. A link, as the row is: the kit's Link goes through Peek's router, and Cmd- or
 * Ctrl-click opens a new tab. `seen` draws it quieter: an Earlier line on a page's list (ACT-4).
 */
export function NewsLine({ item, details, href, onClick, where, seen = false }: {
  item: RowNewsItem
  details: ReturnType<typeof useNewsLineDetails>
  href: string
  onClick?: (event: MouseEvent<HTMLElement>) => void
  /** The place it was said in, on a team's list. */
  where?: string
  seen?: boolean
}) {
  const person = details.nameOf.get(item.by)
  // Never the viewer: their own message lights nothing.
  const name = person?.name ?? 'Someone'
  const title = item.file ? details.titleOf(item.file) : undefined
  const words = details.wordsOf(item)
  const place = [where, title].filter(Boolean).join(' › ')
  const picture = details.avatarSrcFor(name)
  // The kit's line (Katerina, 16 November): it was drawn here by hand, a card whose edge showed on hover, as the
  // navigation prototype drew it a second time. Same words; the reason's mark beside the first line.
  return (
    <ActivityLine
      href={href}
      {...(onClick ? { onClick } : {})}
      mark={markOf(item, seen)}
      person={{ name, ...(picture ? { picture } : {}), ...(person?.bot ? { bot: true } : {}) }}
      did={item.reaction ? reactedWords(item.reaction.emoji) : VERB[item.reason as UnreadReason]}
      time={formatActive(item.at * 1000)}
      {...(place ? { where: place } : {})}
      {...(words ? { words: previewText(words) } : {})}
      seen={seen}
      data-seen={seen || undefined}
      data-reaction={item.reaction ? '' : undefined}
    />
  )
}
