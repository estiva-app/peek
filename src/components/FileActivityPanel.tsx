import { useMemo } from 'react'
import { SectionHeader } from '@estiva-app/ui'
import { KIND_COMMENT } from '@estiva-app/conversation'
import { formatReplyTimestamp, useMentionConversation, useResolvedReferences, useWorkspaceDirectory, type ConversationData } from '@/api'
import type { FileMention } from '@/nostr/fileMentions'
import { TopicActivity, type TopicActivityItem } from '@/components/TopicActivity'
import { project } from '@/components/views/useFileConversationView'

const LIVE = { live: true }

/**
 * **Activity on a file's page: the comments elsewhere that name it** — CON-11.
 *
 * A file's own conversation is the middle column; this is the other list
 * CON-9's model allows, *conversations on files related to it*, and a file
 * has one relation today: it was mentioned. A comment on another file whose
 * body names this one carries the address as an `a` tag (the link reader's
 * `tagsFor`, an edit's too), and `useFileMentions` reads those off the relay
 * by `#a`, listing each while its latest words still name the file.
 *
 * ## Drawn the way the topic panel draws one
 *
 * The row is `TopicActivity`'s mention row: the chip says *Mentioned in*, the
 * file it was said on is named beside it, and the card is the kit's, as every
 * message is since the one conversation (its quieter `subdued` look went with
 * it, ui 0.96.0). A mention is anyone typing your address, retroactive and
 * unwithdrawable (SPEC §5.2), while the conversation beside it is your own, so
 * nothing on the row acts on the message (PEE-48): opening it opens the
 * message where it was said, with its thread.
 *
 * ## The column it lives in
 *
 * A section of the file's Overview, the third column (`OverviewPanel`): under
 * another app's card, or alone. A thread is what somebody just asked for and
 * takes the column while it is open. The column is closed whenever a file
 * is opened, and the header's sidebar button shows it, with this section's
 * empty line when nothing names the file (`useSidePanel`).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/activity-lists-only-mentions-from-elsewhere.md
 */
export function FileActivityPanel({ address, mentions }: { address?: string; mentions: FileMention[] }) {
  const people = useWorkspaceDirectory()
  /*
    The file each mention was said on, by address, for its title — one
    resolve per distinct file, not per mention. `undefined` while the relay is
    still answering, `null` for a file the viewer cannot read; the row is drawn
    either way, with the chip and no name, rather than held back for a label.
    Followed while shown, so a rename in Ship reaches the row.
  */
  const saidIn = useMemo(() => [...new Set(mentions.map((m) => m.saidIn))], [mentions])
  const objects = useResolvedReferences(saidIn, LIVE)
  const labelFor = useMemo(() => {
    const labels = new Map<string, string>()
    for (const address of saidIn) {
      const title = objects[address]?.slots.title?.value
      if (title) labels.set(address, title)
    }
    return labels
  }, [saidIn, objects])
  /*
    Each message as it is now (PEE-48), folded by the stream's own `project`
    so a row and the conversation it came from cannot disagree. Until the
    first read lands a row is the mention as it was written.
  */
  const { current, viewerPubkey } = useMentionConversation(address, mentions)
  const now = useMemo(
    () => (current ? project(current.conversation, viewerPubkey, people).byId : null),
    [current, viewerPubkey, people],
  )
  const items = useMemo(
    () =>
      mentions.flatMap((m) => {
        // Asked about and gone: an edit took the file out of it (Katerina, 8 October).
        if (current?.asked.has(m.id) && !now?.[m.id]) return []
        return [mentionItem(m, people, now?.[m.id]?.data)]
      }),
    [mentions, people, current, now],
  )
  return <FileActivityPanelView items={items} labelFor={labelFor} here={address} />
}

/**
 * One mention as the row `TopicActivity` draws: the same card the stream
 * draws, read-only, opening the message where it was said.
 *
 * `now` is the message as it stands (`project`'s), when it has been read: its
 * text, files, reactions, replies and resolution are drawn from it. Who said
 * it and when stay the mention's, named from the directory as before.
 */
function mentionItem(m: FileMention, people: ReturnType<typeof useWorkspaceDirectory>, now?: ConversationData): TopicActivityItem {
  const author = people?.[m.author]
  const conv: ConversationData = {
    id: m.id,
    // A dash for a person nobody has named, as the kit's Person draws one: never their key.
    authorName: author?.displayName ?? '—',
    authorAvatarSrc: author?.picture,
    authorBot: author?.bot === true,
    // No day divider above these rows, so each names its own day: a bare time means today (format.ts).
    timestamp: formatReplyTimestamp(m.createdAt * 1000),
    body: now?.body ?? m.body,
    editedAt: now?.editedAt,
    createdAtMs: m.createdAt * 1000,
    files:
      now?.files ??
      m.files.map((f) => ({
        name: f.name,
        contentType: f.contentType,
        size: f.size,
        sha256: f.sha256,
        mediaUrl: f.mediaUrl,
        thumbUrl: f.thumbUrl,
      })),
    reactions: now?.reactions,
    replyCount: now?.replyCount,
    replyAuthors: now?.replyAuthors,
    lastReplyTime: now?.lastReplyTime,
    isResolved: now?.isResolved,
    resolvedBy: now?.resolvedBy,
    resolutionMessage: now?.resolutionMessage,
    nostrReferences: m.references,
    urgentMentions: m.urgent,
    embeds: now?.embeds ?? m.embeds,
    // A comment's own file (its `A`, the place it was said): a line that is only a link to it draws nothing, as in its own conversation (ONE-11).
    ownFile: m.kind === KIND_COMMENT ? [m.saidIn] : undefined,
    nostrEventId: m.id,
    // Nothing here edits or deletes (SHI-29): say so, rather than let the card
    // guess ownership from a display name anybody can set to "You".
    canEditAndDelete: false,
  }
  /*
    The message itself, where it was said (PEE-48): `/message/<id>` finds its
    place — a DM, a topic, a file's thread — and opens the thread on it. A
    link to the place alone landed beside the message, or on nothing.
  */
  return { conv, about: m.saidIn, href: `/message/${m.id}` }
}

/**
 * Activity as drawn: its heading with how many, over the rows. Pure, for the story.
 *
 * A section of the Overview panel (`OverviewPanel`), never a panel of its own:
 * under another app's card, or alone on a file Peek owns, in the one scroll
 * the column has (Katerina, 27 September).
 */
export function FileActivityPanelView({
  items,
  labelFor,
  here,
}: {
  items: TopicActivityItem[]
  /** Address → the title of the file a mention was said on. Missing while it resolves. */
  labelFor: Map<string, string>
  /** The file this panel is on: no card for it under a mention, only its chip (WID-3). */
  here?: string
}) {
  return (
    <div className="flex flex-col">
      {/* 16px above the heading, and its own 8px inset brought to the card's 16px edge, on the heading itself. The count beside the title (7 October). */}
      <SectionHeader title="Activity" count={items.length > 0 ? items.length : undefined} className="mx-2 mt-4" />
      {/* Every row opens where it was said (`href`): its thread is on another file's page. */}
      <TopicActivity items={items} labelFor={labelFor} here={here} />
    </div>
  )
}
