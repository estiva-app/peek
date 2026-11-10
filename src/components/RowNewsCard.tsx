import { useNavigate } from 'react-router-dom'
import { Button, Card, MetaText, Person } from '@estiva-app/ui'
import type { UnreadReason } from '@estiva-app/conversation'
import { useMemo } from 'react'
import { CARD_LINES, formatActive, newestFirst, useAvatarSrc, useListedFill, useListedFillOf, useMentionNames, useRowNewsDetails, type RowNewsItem } from '@/api'
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
 * The card on a lit row in Topics, Teams or People (ACT-3; the activity indicator prototype Miky approved on 10
 * November): what is new there, newest first — who, what, on which file, the words and when. At most five lines;
 * more than that ends with "N more", which opens the place. A line opens where it was said: a topic's message or a
 * listed file's comment at its thread, a team chat's or a DM's in the place. Only what is new (Miky, 10 November):
 * the row's dot and this card are one list.
 */
export function RowNewsCard({ items: held, fileRef, placeHref, place, onOpen }: {
  items: readonly RowNewsItem[]
  /** A topic's row: its listed files' other new comments are read while the card is open (383a4d3b). */
  fileRef?: string
  /** The row's own link: where "N more" goes, and where a line with no file opens. */
  placeHref: string
  /** A topic or space (its lines open at their thread), a team's chat, or a DM (its lines open the DM). */
  place: 'topic' | 'chat' | 'dm'
  /** What the row's own click does before its page opens (a topic row keeps its column beside it): `file` is a line's listed file, else none. */
  onOpen?: (file: string | undefined) => void
}) {
  const navigate = useNavigate()
  // The column holds only each listed file's newest comment from before the page opened: the rest, read now.
  const filled = useListedFill(useListedFillOf(fileRef ?? ''))
  const items = useMemo(() => (filled?.length ? newestFirst(held, filled) : held), [held, filled])
  const { wordsOf, titleOf } = useRowNewsDetails(items)
  const names = useMentionNames()
  const avatarSrcFor = useAvatarSrc()
  const nameOf = new Map((names ?? []).map((n) => [n.pubkey, n] as const))
  const shown = items.slice(0, CARD_LINES)
  const more = items.length - shown.length
  // Every line opens at its thread (`?thread=`, read by FilePage, TeamChat and the DM view), except a team chat's or a
  // DM's message that answers nothing: that one is in the place itself, at the bottom, where it opens.
  const thread = (item: RowNewsItem) => `?thread=${encodeURIComponent(item.root)}`
  const hrefOf = (item: RowNewsItem) =>
    item.file
      ? `${filePath(item.file)}${thread(item)}`
      : place === 'topic' || item.root !== item.id
        ? `${placeHref}${thread(item)}`
        : placeHref
  return (
    <>
      {shown.map((item) => {
        const person = nameOf.get(item.by)
        // Never the viewer: their own message lights nothing.
        const name = person?.name ?? 'Someone'
        const title = item.file ? titleOf(item.file) : undefined
        const words = wordsOf(item)
        return (
          // A link, as the row is: the kit's Link goes through Peek's router, and Cmd- or Ctrl-click opens a new tab.
          <Card key={item.id} href={hrefOf(item)} fill="none" quietUntilHover hover="fill" onClick={() => onOpen?.(item.file)} className="flex min-w-0 flex-col gap-0.5 p-2">
            <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
              <span className="flex min-w-0 shrink-0 text-h5 leading-tight text-text-primary">
                <Person size={16} name={name} picture={avatarSrcFor(name)} {...(person?.bot ? { bot: true } : {})} />
              </span>
              <span className="truncate">{VERB[item.reason]}</span>
              <MetaText size="chip" className="ml-auto shrink-0">
                {formatActive(item.at * 1000)}
              </MetaText>
            </div>
            {(title || words) && (
              <div className="truncate text-caption text-text-muted">
                {title && <span className="text-text-secondary">{title}{words ? ' · ' : ''}</span>}
                {words ? previewText(words) : null}
              </div>
            )}
          </Card>
        )
      })}
      {more > 0 && (
        <Button variant="muted" size="small" onClick={() => {
            onOpen?.(undefined)
            navigate(placeHref)
          }} className="self-start">
          {`${more} more`}
        </Button>
      )}
    </>
  )
}
