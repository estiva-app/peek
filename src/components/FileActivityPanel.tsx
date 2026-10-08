import { useMemo } from 'react'
import { SectionHeader } from '@estiva-app/ui'
import { formatTimestamp, useResolvedReferences, useWorkspaceDirectory, type ConversationData } from '@/api'
import type { FileMention } from '@/nostr/fileMentions'
import { TopicActivity, type TopicActivityItem } from '@/components/TopicActivity'

/**
 * **Activity on a file's page: the comments elsewhere that name it** — CON-11.
 *
 * A file's own conversation is the middle column; this is the other list
 * CON-9's model allows, *conversations on files related to it*, and a file
 * has one relation today: it was mentioned. A comment on another file whose
 * body names this one carries the address as an `a` tag (`referenceTagsFor`),
 * and `useFileMentions` reads those off the relay by `#a`.
 *
 * ## Drawn the way the topic panel draws one
 *
 * The row is `TopicActivity`'s mention row: the chip says *Mentioned in*, the
 * file it was said on is named beside it, and the card is `subdued` — the
 * hairline alone, as Ship draws a mention — because a mention is anyone
 * typing your address, retroactive and unwithdrawable (SPEC §5.2), while the
 * conversation beside it is your own. Nothing on the row acts on the message
 * (PEE-48): opening it opens the message where it was said, with its thread.
 *
 * ## The column it lives in
 *
 * A section of the file's Overview, the third column (`OverviewPanel`): under
 * another app's card, or alone. A thread is what somebody just asked for and
 * takes the column while it is open. The column is shown when there is
 * something in it and hidden when there is not, and the header's sidebar
 * button shows it anyway, with this section's empty line (`useSidePanel`).
 */
export function FileActivityPanel({ mentions }: { mentions: FileMention[] }) {
  const people = useWorkspaceDirectory()
  /*
    The file each mention was said on, by address, for its title — one
    resolve per distinct file, not per mention. `undefined` while the relay is
    still answering, `null` for a file the viewer cannot read; the row is drawn
    either way, with the chip and no name, rather than held back for a label.
  */
  const saidIn = useMemo(() => [...new Set(mentions.map((m) => m.saidIn))], [mentions])
  const objects = useResolvedReferences(saidIn)
  const labelFor = useMemo(() => {
    const labels = new Map<string, string>()
    for (const address of saidIn) {
      const title = objects[address]?.slots.title?.value
      if (title) labels.set(address, title)
    }
    return labels
  }, [saidIn, objects])
  const items = useMemo(() => mentions.map((m) => mentionItem(m, people)), [mentions, people])
  return <FileActivityPanelView items={items} labelFor={labelFor} />
}

/** One mention as the row `TopicActivity` draws: the same card the stream draws, opening the thread it was said in. */
function mentionItem(m: FileMention, people: ReturnType<typeof useWorkspaceDirectory>): TopicActivityItem {
  const author = people?.[m.author]
  const conv: ConversationData = {
    id: m.id,
    authorName: author?.displayName ?? `${m.author.slice(0, 8)}…`,
    authorAvatarSrc: author?.picture,
    timestamp: formatTimestamp(m.createdAt * 1000),
    body: m.body,
    createdAtMs: m.createdAt * 1000,
    files: m.files.map((f) => ({
      name: f.name,
      contentType: f.contentType,
      size: f.size,
      sha256: f.sha256,
      mediaUrl: f.mediaUrl,
      thumbUrl: f.thumbUrl,
    })),
    nostrReferences: m.references,
    urgentMentions: m.urgent,
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
  return { conv, about: m.saidIn, relation: 'mention', href: `/message/${m.id}` }
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
}: {
  items: TopicActivityItem[]
  /** Address → the title of the file a mention was said on. Missing while it resolves. */
  labelFor: Map<string, string>
}) {
  return (
    <div className="flex flex-col">
      {/* 16px above the heading, and its own 8px inset brought to the card's 16px edge. The count beside the title (7 October). */}
      <div className="px-2 pt-4">
        <SectionHeader title="Activity" count={items.length > 0 ? items.length : undefined} />
      </div>
      {/*
        Every row has an `href` — its thread is on another file's page — so
        nothing here is ever selected and the thread opener is never reached;
        both props are the component's.
      */}
      <TopicActivity items={items} labelFor={labelFor} onOpenThread={() => {}} />
    </div>
  )
}
