import { useNavigate } from 'react-router-dom'
import { Button, Card, MetaText, Person, isPlainClick } from '@estiva-app/ui'
import type { UnreadReason } from '@estiva-app/conversation'
import { useMemo, type MouseEvent } from 'react'
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

/**
 * What a reaction line says someone did (ACT-7): "reacted 👍 to your message", and "on <file>" when it is on a file the
 * row's place lists.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-reaction-names-whose-message-it-reacts-to.md
 */
function reactedWords(emoji: string, file: string | undefined): string {
  return `reacted ${emoji} to your message${file ? ` on ${file}` : ''}`
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
  return (
    <>
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
    </>
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
  // A reaction names the file in its own words ("… to your message on <file>"), so its place line does not repeat it.
  const place = [where, item.reaction ? undefined : title].filter(Boolean).join(' › ')
  return (
    <Card href={href} fill="none" quietUntilHover hover="fill" onClick={onClick} className="flex min-w-0 flex-col gap-0.5 p-2" data-seen={seen || undefined} data-reaction={item.reaction ? '' : undefined}>
      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <span className={`flex min-w-0 shrink-0 text-h5 leading-tight ${seen ? 'text-text-secondary' : 'text-text-primary'}`}>
          <Person size={16} name={name} picture={details.avatarSrcFor(name)} {...(person?.bot ? { bot: true } : {})} />
        </span>
        {/* A reaction to you, in the reaction's orange while it is new (ACT-7; the approved card). */}
        <span className={`truncate ${item.reaction && !seen ? 'text-warning-default' : ''}`}>
          {item.reaction ? reactedWords(item.reaction.emoji, title) : VERB[item.reason as UnreadReason]}
        </span>
        <MetaText size="chip" className="ml-auto shrink-0">
          {formatActive(item.at * 1000)}
        </MetaText>
      </div>
      {(place || words) && (
        <div className="truncate text-caption text-text-muted">
          {place && <span className="text-text-secondary">{place}{words ? ' · ' : ''}</span>}
          {words ? previewText(words) : null}
        </div>
      )}
    </Card>
  )
}
