import { useNavigate } from 'react-router-dom'
import { ScrollArea } from '@estiva-app/ui'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConversationCard } from '@/components/ConversationCard'
import type { ConversationData } from '@/api'

/**
 * **Activity: the conversations of files related to this topic** — CON-9.
 *
 * The model agreed 2026-09-05 replaces a growing list of modes with two lists,
 * and one rule decides which a thread lands in: *identity merges; relation
 * aggregates.* A topic and the project in its Folder are the same file, so the
 * project's own comments stay in the stream. A comment on one of its tickets is
 * a **different file's** conversation and aggregates here.
 *
 * ## Why the stream got quieter, and why that is the point
 *
 * Ship publishes a comment into the project's Folder, which *is* this topic's
 * channel — that is "one container, many projections" working, and it is how
 * every issue comment ever written has arrived in Peek. It arrived as an
 * ordinary message, indistinguishable from somebody talking in the topic.
 *
 * Measured against production on 2026-09-06: **422 of 453 threads, 93%**, across
 * every paired topic. The container was right and the projection was not — a
 * reader had no way to tell "Ravi said this here" from "Ravi commented on a
 * ticket". Those threads are not lost; they are one tab across, under the
 * ticket they were always about.
 *
 * ## Same list, not same weight
 *
 * The second relation is a **mention** — CON-11. A topic is
 * `39000:<relay>:<uuid>` (RFC 0.4 §5.2), and a message in any other channel
 * that names it carries the address as an `a` tag; `useTopicMentions` reads
 * those off the relay. It is drawn lighter, as Ship draws one, because a
 * mention is anyone typing your address — retroactive and permanently
 * unwithdrawable (§5.2) — while a sub-file's thread is your own subtree. Same
 * list, one order, and the chip says which.
 *
 * ## Replies go to the file the thread belongs to
 *
 * Opening a thread here opens the same thread panel the stream opens, which
 * replies into that thread — so a reply lands on the ticket's conversation and
 * never on the topic's. That falls out of the data rather than being enforced
 * here, but the row names the ticket, because a composer whose destination is a
 * different object than the page around it is otherwise a trap.
 *
 * A mention has no thread here at all: it was said in another topic, whose
 * conversation this page does not hold. So its row opens that topic (`href`),
 * where the message can be read in place and replied to — the same rule, with
 * the destination one page away instead of one column.
 */
/**
 * How a row relates to the file it is shown on — the related file's own
 * conversation (a sub-file) or a mention of it somewhere else (SPEC §6.4).
 */
export type ActivityRelation = 'sub-file' | 'mention'

export interface TopicActivityItem {
  conv: ConversationData
  /** Which related file this conversation belongs to — a sub-file's address,
   *  or the address of the topic a mention was said in. Undefined when it
   *  resolved to nothing. */
  about?: string
  /** How it is related. Absent means a sub-file, which is what every row was before CON-11. */
  relation?: ActivityRelation
  /** Where the row opens instead of a thread: the topic a mention was said in. */
  href?: string
}

/**
 * The words, in one place. *"Mentioned in"* is SPEC §6.4's own phrase, kept
 * verbatim as Ship keeps it, so the two apps and the specification cannot drift
 * into three names for one thing.
 */
const RELATION: Record<ActivityRelation, { label: string; muted: boolean }> = {
  'sub-file': { label: 'On a file', muted: false },
  mention: { label: 'Mentioned in', muted: true },
}

/** The box the rows live in, written once: the list and its empty line both sit in it. */
const LIST = 'flex flex-col px-4 py-4 gap-3'

export function TopicActivity({
  items,
  labelFor,
  selectedId,
  onOpenThread,
}: {
  items: TopicActivityItem[]
  /** Address → the name the owning app gives it. Missing while the Folder resolves. */
  labelFor: Map<string, string>
  selectedId?: string | null
  onOpenThread: (id: string) => void
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
    <ScrollArea className="flex-1" contentClassName={LIST}>
      {items.map(({ conv, about, relation = 'sub-file', href }) => {
        const words = RELATION[relation]
        const open = href ? () => navigate(href) : () => onOpenThread(conv.id)
        return (
        <div key={conv.id} className="flex flex-col gap-1" data-relation={relation}>
          <div className="flex items-center gap-2">
            <Chip type="neutral" label={words.label} />
            {/*
              The ticket's own title, from its own app's manifest. Absent while
              the Folder is still resolving, and drawn as nothing rather than as
              a placeholder — a row that says "Loading…" beside a real message is
              worse than a row that simply has not said where it is from yet.
            */}
            {about && labelFor.get(about) && (
              <span className="truncate text-caption text-text-muted">{labelFor.get(about)}</span>
            )}
          </div>
          {/*
            The same card the stream draws. A conversation should look like a
            conversation wherever it is read, and the card already renders the
            ticket's own widget beneath the message — so the row's chip says how
            it is related and the widget says what it is about.
          */}
          <ConversationCard
            authorName={conv.authorName}
            authorAvatarSrc={conv.authorAvatarSrc}
            timestamp={conv.timestamp}
            body={conv.body}
            files={conv.files}
            reactions={conv.reactions}
            highlightType={conv.highlightType}
            replyCount={conv.replyCount}
            replyAuthors={conv.replyAuthors}
            lastReplyTime={conv.lastReplyTime}
            isResolved={conv.isResolved}
            resolvedBy={conv.resolvedBy}
            resolutionMessage={conv.resolutionMessage}
            nostrReferences={conv.nostrReferences}
            nostrBlockId={conv.nostrBlockId}
            subdued={words.muted}
            isSelected={selectedId === conv.id}
            onClick={open}
            onReply={open}
          />
        </div>
        )
      })}
    </ScrollArea>
  )
}
