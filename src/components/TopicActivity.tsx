import { useNavigate } from 'react-router-dom'
import { ConversationPlace, EmptyState } from '@estiva-app/ui'
import { ConversationCard } from '@/components/ConversationCard'
import type { ConversationData } from '@/api'

/**
 * **Activity: where this file is mentioned elsewhere** — CON-11, in a file's Overview (`FileActivityPanel`).
 *
 * A message in any other conversation that names this file carries its address as an `a` tag, and the file's
 * mentions are read off the relay by it. Each row is that message as it is now, under the kit's
 * `ConversationPlace` saying *Mentioned in* and where — SPEC §6.4's own phrase, kept verbatim as Ship keeps it.
 *
 * A mention has no thread here: it was said in another conversation, which this page does not hold. So the row
 * opens that conversation (`href`), where the message can be read in place and replied to, and nothing on it is
 * offered here — no menu, no reply, no reaction to toggle, no resolve (PEE-48, Katerina, 8 October).
 *
 * A topic's own files' conversations are no longer rolled up here (CON-9's "On a file"): followed at All, a topic
 * draws them in its own list, each under its file's heading (TOPI-3).
 */
export interface TopicActivityItem {
  conv: ConversationData
  /** The address of the conversation it was said in. Undefined when it resolved to nothing. */
  about?: string
  /** Where the row opens: the message, where it was said. */
  href: string
}

/** The box the rows live in, written once: the list and its empty line both sit in it. */
// 4px under the heading, so the rows and the empty line read as its own (Katerina, 7 October).
const LIST = 'flex flex-col px-4 pt-1 pb-4 gap-3'

export function TopicActivity({
  items,
  labelFor,
  here,
}: {
  items: TopicActivityItem[]
  /** The address of the file this list is on: its messages draw no card for it, only its chip (WID-3). */
  here?: string
  /** Address → the name the owning app gives it. Missing while the Folder resolves. */
  labelFor: Map<string, string>
}) {
  const navigate = useNavigate()
  if (items.length === 0) {
    // One section of the panel is empty: the line alone, left, no icon (B18,
    // D41), where the list's first row would be — in the list's own box, and
    // never padded itself (Katerina, 2026-09-14).
    return (
      <div className={LIST}>
        <EmptyState scope="section" message="No related conversations yet." />
      </div>
    )
  }

  return (
    // The rows only: the Panel they sit in scrolls them (estiva-ui 0.37.0), so there is one scroll, not two.
    <div className={LIST}>
      {items.map(({ conv, about, href }) => (
        /*
          The kit's ConversationPlace (B14): the chip saying how it is related, and where it was said, from its own
          app's manifest — absent while the Folder is still resolving, and drawn as nothing rather than as a
          placeholder.
        */
        <ConversationPlace key={conv.id} relation="Mentioned in" place={about ? labelFor.get(about) : undefined} data-relation="mention">
          {/*
            The same card the stream draws. A conversation should look like a
            conversation wherever it is read, and the card already renders the
            file's own widget beneath the message.
          */}
          <ConversationCard
            authorName={conv.authorName}
            authorAvatarSrc={conv.authorAvatarSrc}
            authorBot={conv.authorBot}
            timestamp={conv.timestamp}
            createdAtMs={conv.createdAtMs}
            body={conv.body}
            editedAt={conv.editedAt}
            files={conv.files}
            reactions={conv.reactions}
            highlightType={conv.highlightType}
            replyCount={conv.replyCount}
            replyAuthors={conv.replyAuthors}
            lastReplyTime={conv.lastReplyTime}
            isResolved={conv.isResolved}
            resolvedBy={conv.resolvedBy}
            resolutionMessage={conv.resolutionMessage}
            urgentMentions={conv.urgentMentions}
            parts={conv.parts}
            embeds={conv.embeds}
            here={here}
            readOnly
            onClick={() => navigate(href)}
          />
        </ConversationPlace>
      ))}
    </div>
  )
}
