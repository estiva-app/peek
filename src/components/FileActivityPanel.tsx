import { useMemo } from 'react'
import { ContainerHeader } from '@estiva-app/ui'
import { KIND } from '@estiva-app/protocol'
import { formatTimestamp, useResolvedReferences, useWorkspaceDirectory, type ConversationData } from '@/api'
import type { FileMention } from '@/nostr/fileMentions'
import { filePath } from '@/lib/objectUrl'
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
 * conversation beside it is your own. Opening the row opens the thread it was
 * said in, on that file's page: this page holds none of that file's threads.
 *
 * ## The column it lives in
 *
 * The third column, where a thread opens (`FilePage`). A thread is what
 * somebody just asked for and wins; Activity is context the page shows when
 * there is some — a file nobody has named keeps its two columns, since a
 * third that says only "No related conversations yet." would change every
 * file's page for the few that have one.
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
    nostrEventId: m.id,
  }
  /*
    A comment opens the thread it was said in, on that file's page. A topic
    message (`kind:9`, CON-14) opens its topic, whose page has no thread
    parameter — `FilePage` sends a `39000:` address on to the topic's page.
  */
  const href = m.kind === KIND.STREAM_MESSAGE ? filePath(m.saidIn) : `${filePath(m.saidIn)}?thread=${m.threadId}`
  return { conv, about: m.saidIn, relation: 'mention', href }
}

/** The column as drawn: a header saying Activity and how many, over the rows. Pure, for the story. */
export function FileActivityPanelView({
  items,
  labelFor,
}: {
  items: TopicActivityItem[]
  /** Address → the title of the file a mention was said on. Missing while it resolves. */
  labelFor: Map<string, string>
}) {
  return (
    <div className="flex h-full flex-col">
      <ContainerHeader
        title={
          <div className="flex items-center gap-2">
            <span className="text-body-2-strong text-text-primary">Activity</span>
            {items.length > 0 && <span className="font-mono text-caption text-text-muted">{items.length}</span>}
          </div>
        }
      />
      {/*
        Every row has an `href` — its thread is on another file's page — so
        nothing here is ever selected and the thread opener is never reached;
        both props are the component's.
      */}
      <TopicActivity items={items} labelFor={labelFor} onOpenThread={() => {}} />
    </div>
  )
}
