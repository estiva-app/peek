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
 * Ship's Activity carries mentions too, and draws them lighter, because a
 * mention is anyone typing your address — retroactive and permanently
 * unwithdrawable (§5.2) — while a sub-file's thread is your own subtree. Peek
 * has only the sub-file half so far: a topic is not an addressable object until
 * files nest, so *"conversations that mention this topic"* is not a question the
 * relay can answer about it. The chip is already the place that distinction
 * goes when it arrives.
 *
 * ## Replies go to the file the thread belongs to
 *
 * Opening a thread here opens the same thread panel the stream opens, which
 * replies into that thread — so a reply lands on the ticket's conversation and
 * never on the topic's. That falls out of the data rather than being enforced
 * here, but the row names the ticket, because a composer whose destination is a
 * different object than the page around it is otherwise a trap.
 */
export interface TopicActivityItem {
  conv: ConversationData
  /** The sub-file's address, or undefined if it resolved to nothing. */
  about?: string
}

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
  if (items.length === 0) {
    // One section of the panel is empty: the line alone, left, no icon (B18,
    // D41), in the same padding as the list it stands for.
    return <EmptyState scope="section" className="px-4 py-4" message="No related conversations yet." />
  }

  return (
    <ScrollArea className="flex-1" contentClassName="flex flex-col px-4 py-4 gap-3">
      {items.map(({ conv, about }) => (
        <div key={conv.id} className="flex flex-col gap-1" data-relation="sub-file">
          <div className="flex items-center gap-2">
            <Chip type="neutral" label="On a file" />
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
            attachments={conv.attachments}
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
            showCreateTopic={false}
            isSelected={selectedId === conv.id}
            onClick={() => onOpenThread(conv.id)}
            onReply={() => onOpenThread(conv.id)}
          />
        </div>
      ))}
    </ScrollArea>
  )
}
