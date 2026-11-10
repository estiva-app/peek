import { useNavigate } from 'react-router-dom'
import { Button, Card, MetaText, Person } from '@estiva-app/ui'
import type { UnreadReason } from '@estiva-app/conversation'
import { CARD_LINES, formatActive, useAvatarSrc, useMentionNames, useRowNewsDetails, type RowNewsItem } from '@/api'
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
export function RowNewsCard({ items, placeHref, place }: {
  items: readonly RowNewsItem[]
  /** The row's own link: where "N more" goes, and where a line with no file opens. */
  placeHref: string
  /** A topic or space (its lines open at their thread), a team's chat, or a DM (its lines open the DM). */
  place: 'topic' | 'chat' | 'dm'
}) {
  const navigate = useNavigate()
  const { wordsOf, titleOf } = useRowNewsDetails(items)
  const names = useMentionNames()
  const avatarSrcFor = useAvatarSrc()
  const nameOf = new Map((names ?? []).map((n) => [n.pubkey, n] as const))
  const shown = items.slice(0, CARD_LINES)
  const more = items.length - shown.length
  // A topic and a file open at the thread (FilePage reads `?thread=`); a team's chat and a DM open the place.
  const threadable = place === 'topic'
  const hrefOf = (item: RowNewsItem) =>
    item.file ? `${filePath(item.file)}?thread=${encodeURIComponent(item.root)}` : threadable ? `${placeHref}?thread=${encodeURIComponent(item.root)}` : placeHref
  return (
    <>
      {shown.map((item) => {
        const person = nameOf.get(item.by)
        // Never the viewer: their own message lights nothing.
        const name = person?.name ?? 'Someone'
        const title = item.file ? titleOf(item.file) : undefined
        const words = wordsOf(item)
        return (
          <Card key={item.id} fill="none" quietUntilHover hover="fill" onClick={() => navigate(hrefOf(item))} className="flex min-w-0 flex-col gap-0.5 p-2">
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
        <Button variant="muted" size="small" onClick={() => navigate(placeHref)} className="self-start">
          {`${more} more`}
        </Button>
      )}
    </>
  )
}
