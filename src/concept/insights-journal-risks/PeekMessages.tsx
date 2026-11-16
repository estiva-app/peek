/**
 * CONCEPT — Peek's part of Insights, Journal and Risks (prototype issue 009bc509). Peek's real frame, Topics column and
 * message card, with Mark as… in each message's ⋯ (the kit card's `menu` slot, after Resolve) and a marked message's
 * line, handed in through `ConceptMessage` — the one concept-only hook in `ConversationCard.tsx`. Draws only what a
 * person sees; nothing here reads or writes the relay. Never merged.
 */
import { useState, type ReactNode } from 'react'
import { Card, ConversationLayout, EmptyState, ListColumn, MetaText, NavItem, NavTree, PageHeader, Person } from '@estiva-app/ui'
import { ConversationCard, ConceptMessage } from '@/components/ConversationCard'
import { TopicState } from '@/components/ui/TopicState'
import { ConversationBox } from '@/components/ui/ConversationBox'
import { TopicsColumnView } from '@/components/views/TopicsColumn'
import { PeekFrame } from '@/layouts/PeekFrame'
import { useRailClosed } from '@/layouts/railClosed'
import { formatActive, formatDateLabel, formatTimestamp } from '@/api'
import { MarkAsRows, MarkedLine, MarkedNotice, type MarkWord } from './MarkAs'
import { MIKY, TEAM, type Person as Who } from './fixtures'
import { NOW, TOPICS, marked, titleOf, type StoryMark, type StoryMessage } from './messages'

/**
 * Hands Peek's message card its Mark as… rows and its line. `privateRoom` is a place whose readers differ from any
 * team's (a DM): no Mark row at all. Marking is at once, with a notice; Unmark takes the line away.
 */
function MarkingProvider({ messages, privateRoom, me, about, notice: startNotice, children }: { messages: StoryMessage[]; privateRoom: boolean; me: Who; about?: string; notice?: MarkWord; children: ReactNode }) {
  const [marks, setMarks] = useState<Record<string, StoryMark | undefined>>(() => Object.fromEntries(messages.map((m) => [m.id, m.mark])))
  const [notice, setNotice] = useState<MarkWord | undefined>(startNotice)
  const mark = (id: string, text: string, word: MarkWord) => {
    // The title from the message's first line; filed in the message's team, about its topic's project (Decided, kickoff).
    const title = text.split('\n')[0].split(/(?<=[.!?])\s/)[0].slice(0, 80)
    setMarks((all) => ({ ...all, [id]: marked(word, title, me) }))
    setNotice(word)
  }
  const value = {
    menu: (id: string, text: string) => (
      <MarkAsRows mark={marks[id]} refused={privateRoom} onMark={(word) => mark(id, text, word)} onUnmark={() => setMarks((all) => ({ ...all, [id]: undefined }))} />
    ),
    wrap: (id: string, card: ReactNode) => {
      const m = marks[id]
      // The shared line's hover is "<word> · <title>"; Peek's names who marked it too, since anyone may mark anyone's.
      return <MarkedLine mark={m && { ...m, title: `${m.title} · marked by ${m.by.key === me.key ? 'you' : m.by.name}` }}>{card}</MarkedLine>
    },
  }
  return (
    <ConceptMessage.Provider value={value}>
      {children}
      {notice && <MarkedNotice word={notice} team={TEAM} about={about} onClose={() => setNotice(undefined)} />}
    </ConceptMessage.Provider>
  )
}

/** A topic's or a DM's conversation as Peek's file page draws it: the kit's ConversationLayout, two columns, under the page's bar. */
export function Conversation({ title, messages, me = MIKY, privateRoom = false, about, dm = false, notice }: {
  title: string
  messages: StoryMessage[]
  /** Who is signed in: their own messages offer Edit and Delete. */
  me?: Who
  privateRoom?: boolean
  /** What its items are about: the topic's project. */
  about?: string
  dm?: boolean
  /** Start with the notice of a mark just made. */
  notice?: MarkWord
}) {
  const items = messages.map((m) => ({
    id: m.id,
    day: formatDateLabel(NOW - m.ago, NOW),
    card: (
      <ConversationCard
        messageId={m.id}
        authorName={m.author.name}
        timestamp={formatTimestamp(NOW - m.ago, NOW)}
        createdAtMs={NOW - m.ago}
        body={m.text}
        canEditAndDelete={m.author.key === me.key}
        onDelete={() => {}}
        onResolvedChange={() => {}}
        onReactionsChange={() => {}}
        onBodyChange={() => {}}
      />
    ),
  }))
  return (
    <MarkingProvider messages={messages} privateRoom={privateRoom} me={me} about={about} notice={notice}>
      <ConversationLayout
        threads="beside"
        title={title}
        header={<PageHeader title={title} leading={<TopicState type={dm ? 'DM' : 'topic'} status={dm ? 'default' : 'unresolved'} />} />}
        items={items}
        box={<ConversationBox onSend={async () => ({ accepted: true })} contextLabel={title} />}
        empty={<EmptyState message="No messages yet" />}
      />
    </MarkingProvider>
  )
}

/** Peek's real frame with its real Topics column, a topic open on the right. */
export function TopicFrame({ selected = 0, children }: { selected?: number; children: ReactNode }) {
  return <PeekFrame leftPanel={<TopicsColumnView state={{ mine: TOPICS, others: [], archived: [] }} selectedRef={TOPICS[selected].ref} />} rightPanel={children} />
}

/**
 * The decider's notice, where a mention tells her today: the lit topic row in the Topics column, whose card opens
 * while it is rested on (ACT-3's RowNewsCard). Its line is drawn as that card's NewsLine draws one — who, what they
 * did, when; then where and the words — with the new verb "wrote a decision in your name". The whole line opens the
 * Journal entry, as every line in that card opens what it names.
 */
function DeciderLine({ by, title, place, at }: { by: Who; title: string; place: string; at: number }) {
  return (
    <Card href="#" fill="none" quietUntilHover hover="fill" className="flex min-w-0 flex-col gap-0.5 p-2" data-decider-line>
      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <span className="flex min-w-0 shrink-0 text-h5 leading-tight text-text-primary">
          <Person size={16} name={by.name} />
        </span>
        <span className="truncate">wrote a decision in your name</span>
        <MetaText size="chip" className="ml-auto shrink-0">
          {formatActive(at)}
        </MetaText>
      </div>
      {/* The decision's title in full, on two lines at most: it is what she is told (NewsLine cuts its words at one). */}
      <div className="line-clamp-2 text-caption text-text-muted">
        <span className="text-text-secondary">{place} · </span>
        {title}
      </div>
    </Card>
  )
}

/** The Topics column as Katerina sees it after Miky wrote a decision in her name: its row lit, its card holding the line. */
export function DeciderTopicsColumn({ title, ago }: { title: string; ago: number }) {
  const railClosed = useRailClosed()
  const [lit, open, ...rest] = TOPICS
  return (
    <ListColumn title="Topics" collapsed={railClosed}>
      <NavTree selected={open.ref}>
        <NavItem
          href="#"
          label={titleOf(lit)}
          unread
          icon={<TopicState type="topic" status="unresolved" iconClassName="text-text-primary" />}
          preview={<DeciderLine by={MIKY} title={title} place={titleOf(lit)} at={NOW - ago} />}
        />
        <NavItem href="#" label={titleOf(open)} active icon={<TopicState type="topic" status="unresolved" iconClassName="text-text-primary" />} />
        {rest.map((t) => (
          <NavItem key={t.ref} href="#" label={titleOf(t)} icon={<TopicState type="topic" status="unresolved" />} />
        ))}
        <NavItem href="#" label="Explore topics" />
      </NavTree>
    </ListColumn>
  )
}
