/**
 * CONCEPT — Peek's part of Insights, Journal and Risks (prototype issue 009bc509). Peek's real frame, Topics column and
 * message card, with Mark as… in each message's ⋯ (the kit card's `menu` slot, after Resolve) and a marked message's
 * line, handed in through `ConceptMessage` — the one concept-only hook in `ConversationCard.tsx`. Draws only what a
 * person sees; nothing here reads or writes the relay. Never merged.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconSparkles, IconX } from '@tabler/icons-react'
import { Card, ConversationLayout, EmptyState, IconButton, INLINE_CHIP_CLASSES, ListColumn, Toast, MetaText, NavItem, NavTree, PageHeader, Person, Thread, WithTooltip } from '@estiva-app/ui'
import { ConversationCard, ConceptMessage } from '@/components/ConversationCard'
import { ReplyCard } from '@/components/ReplyCard'
import { TopicState } from '@/components/ui/TopicState'
import { ConversationBox } from '@/components/ui/ConversationBox'
import { TopicsColumnView } from '@/components/views/TopicsColumn'
import { PeekFrame } from '@/layouts/PeekFrame'
import { useRailClosed } from '@/layouts/railClosed'
import { formatActive, formatDateLabel, formatTimestamp } from '@/api'
import { MarkAsRows, MarkedNotice, drawsLine, wordIcon, wordTone, type MarkWord } from './MarkAs'
import { MIKY, TEAM, type Item, type Person as Who } from './fixtures'
import { ItemBeside, itemOf } from './ItemBeside'
import { SURE, suggestFor, useTypedMark } from './TypedMark'
import { cn } from '@/lib/utils'
import { NOW, TOPICS, marked, titleOf, type StoryMark, type StoryMessage } from './messages'

/**
 * Hands Peek's message card its Mark as… rows and its line. `privateRoom` is a place whose readers differ from any
 * team's (a DM): no Mark row at all. Marking is at once, with a notice; Unmark takes the line away.
 */
function MarkingProvider({ messages, privateRoom, me, about, notice: startNotice, onOpen, onOpenItem, children }: { messages: StoryMessage[]; privateRoom: boolean; me: Who; about?: string; notice?: MarkWord; onOpen?: (id: string) => void; onOpenItem?: (mark: StoryMark, message: StoryMessage) => void; children: ReactNode }) {
  // A sure suggestion that arrived after sending marks the message at once; an unsure one is only offered under it.
  const titleOf = (text: string) => text.split('\n')[0].split(/(?<=[.!?])\s/)[0].slice(0, 80)
  const [marks, setMarks] = useState<Record<string, StoryMark | undefined>>(() =>
    Object.fromEntries(messages.map((m) => [m.id, m.mark ?? (m.suggested?.sure ? marked(m.suggested.word, titleOf(m.text), me) : undefined)])),
  )
  const [notice, setNotice] = useState<MarkWord | undefined>(startNotice)
  const [last, setLast] = useState<string>()
  const autoMarked = messages.find((m) => m.suggested?.sure)
  const [undoable, setUndoable] = useState(autoMarked?.id)
  const [offers, setOffers] = useState(() => Object.fromEntries(messages.filter((m) => m.suggested && !m.suggested.sure).map((m) => [m.id, m.suggested!.word])))
  // An offer nobody takes fades (here after 12 s); nothing was marked, so nothing is left behind.
  useEffect(() => {
    if (!Object.keys(offers).length) return
    const t = setTimeout(() => setOffers({}), 12_000)
    return () => clearTimeout(t)
  }, [offers])
  const mark = (id: string, text: string, word: MarkWord) => {
    // The title starts from the message's first line and is edited in the notice; filed in the message's team, about
    // its topic's project (Decided, kickoff).
    setMarks((all) => ({ ...all, [id]: marked(word, titleOf(text), me) }))
    setNotice(word)
    setLast(id)
  }
  const openItem = (id: string | undefined) => {
    const m = id ? marks[id] : undefined
    const message = messages.find((x) => x.id === id)
    if (m && message) onOpenItem?.(m, message)
  }
  const value = {
    menu: (id: string, text: string) => (
      <MarkAsRows mark={marks[id]} refused={privateRoom} onMark={(word) => mark(id, text, word)} onOpen={() => openItem(id)} onUnmark={() => setMarks((all) => ({ ...all, [id]: undefined }))} />
    ),
    wrap: (id: string, card: ReactNode) => {
      const m = marks[id]
      const replies = messages.find((x) => x.id === id)?.replies
      // The label sits beside the time, as Resolved does (Miky, 16 Nov), in place of a line down the left.
      return (
        <InHeader label={drawsLine(m) && m ? <MarkLabel mark={m} me={me} onOpen={onOpenItem && (() => openItem(id))} /> : null}>
          {card}
          {offers[id] && !m && (
            <span className="ml-[44px] flex text-caption text-text-muted">
              <Card fill="none" hover="fill" quietUntilHover className="flex items-center gap-1 px-1" onClick={() => (mark(id, messages.find((x) => x.id === id)?.text ?? '', offers[id]), setOffers({}))}>
                <IconSparkles size={14} stroke={1.5} />
                <span style={wordTone(offers[id])} className="flex opacity-70">
                  {wordIcon(offers[id], 14)}
                </span>
                {offers[id]}?
              </Card>
            </span>
          )}
          {replies?.some((r) => drawsLine(r.mark)) && <ThreadTimeline replies={replies} me={me} onOpen={() => onOpen?.(id)} />}
        </InHeader>
      )
    },
  }
  return (
    <ConceptMessage.Provider value={value}>
      {children}
      {notice && (
        <MarkedNotice
          word={notice}
          team={TEAM}
          about={about}
          title={last ? marks[last]?.title : undefined}
          onTitle={(title) => last && setMarks((all) => (all[last] ? { ...all, [last]: { ...all[last], title } } : all))}
          onOpen={() => openItem(last)}
          onClose={() => setNotice(undefined)}
        />
      )}
      {undoable && autoMarked?.suggested && (
        // The sure suggestion that marked a sent message says so once, with Undo: a delete, so nothing is left behind.
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <Toast
            label={`Suggested: marked as ${autoMarked.suggested.word}.`}
            type="success"
            actionLabel="Undo"
            onAction={() => (setMarks((all) => ({ ...all, [undoable]: undefined })), setUndoable(undefined))}
          />
        </div>
      )}
    </ConceptMessage.Provider>
  )
}

/**
 * A mark's label beside a message's time: its type's icon and word in its colour, the way the kit card draws
 * Resolved there (Miky, 16 Nov; and Peek's HighlightPill, removed 2 Nov, sat after the time). Hover names it.
 */
function MarkLabel({ mark, me, onOpen }: { mark: StoryMark; me: Who; onOpen?: () => void }) {
  // The word's own icon and colour: a Question is orange, not a Risk's red (Miky, 18 Nov).
  const label = (
    <span className="flex items-center gap-1 text-caption" style={wordTone(mark.word)}>
      {wordIcon(mark.word, 14)}
      {mark.word}
    </span>
  )
  return (
    <WithTooltip label={`${mark.word} · ${mark.title} · marked by ${mark.by.key === me.key ? 'you' : mark.by.name}`} wrapperClassName="flex shrink-0">
      {onOpen ? (
        // A press opens the item beside the topic (Miky, 19 Nov), and not the message's thread under it.
        <Card fill="none" hover="fill" quietUntilHover className="-mx-1 px-1" onClick={(e) => (e.stopPropagation(), onOpen())}>
          {label}
        </Card>
      ) : (
        label
      )}
    </WithTooltip>
  )
}

/** Puts `label` into the card's header, right after its time — the kit card has no slot there, so the concept places it. */
function InHeader({ label, children }: { label: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const time = ref.current?.querySelector('time')
    if (!time || !label) return
    const el = document.createElement('span')
    el.style.display = 'inline-flex'
    el.style.marginLeft = '4px'
    ;(time.closest('a') ?? time).insertAdjacentElement('afterend', el)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- concept only: the host exists only once the card has drawn.
    setHost(el)
    return () => el.remove()
  }, [label])
  // @estiva-escape(no-rebuilt-behaviour): concept only, not a layer: it puts the label inline after the time, where the kit card has no slot yet; the build adds one
  const placed = host && label ? createPortal(label, host) : null
  return (
    <div ref={ref}>
      {children}
      {placed}
    </div>
  )
}

/**
 * Bubble up (estiva-ui concept/cross-app-navigation, 28 Oct): a thread's marked replies show under its message in the
 * topic's feed, as a timeline — a line down from the message, a square in the type's colour at each marked reply, the
 * plain replies between said quietly on a dotted stretch. A press anywhere on it opens the whole thread in the right
 * column, as a message's replies open today (Miky, 18 Nov).
 */
function ThreadTimeline({ replies, me, onOpen }: { replies: StoryMessage[]; me: Who; onOpen: () => void }) {
  const steps: { reply: StoryMessage; before: number }[] = []
  let plain = 0
  for (const r of replies) {
    if (drawsLine(r.mark)) {
      steps.push({ reply: r, before: plain })
      plain = 0
    } else plain++
  }
  const quiet = (n: number) => (n ? <span className="text-caption text-text-muted">{n === 1 ? '1 reply' : `${n} replies`}</span> : null)
  return (
    <ol className="ml-[27px] flex flex-col border-l-2 border-border-strong pb-1 pl-5" aria-label="Marked in this thread">
      {steps.map(({ reply, before }) => (
        <li key={reply.id} className="relative pb-3">
          {/* The square on the line, level with the reply's name line, under any quiet "n replies" above it. */}
          <span aria-hidden className={`absolute -left-[25px] size-2 rounded-sm ${before ? 'top-[26px]' : 'top-[6px]'}`} style={wordTone(reply.mark!.word, "backgroundColor")} />
          <Card onPress={onOpen} fill="none" hover="fill" quietUntilHover className="-mx-2 flex flex-col gap-1 px-2">
            {quiet(before)}
            <div className="flex h-5 items-center gap-2">
              <Person size={16} name={reply.author.name} />
              <MarkLabel mark={reply.mark!} me={me} />
              <MetaText size="chip">{formatTimestamp(NOW - reply.ago, NOW)}</MetaText>
            </div>
            <span className="text-body-2 text-text-primary">{reply.text}</span>
          </Card>
        </li>
      ))}
      <li>
        <Card onPress={onOpen} fill="none" hover="fill" quietUntilHover className="flex items-center gap-2 px-2 py-1">
          <span className="text-caption text-text-interactive">{replies.length} replies</span>
          {plain ? <span className="text-caption text-text-muted">· {plain} since the last mark</span> : null}
        </Card>
      </li>
    </ol>
  )
}

/** A message's whole thread in the right column, as Peek's ThreadPanel draws it: the message pinned on top, then every reply. */
function WholeThread({ message, me, onClose, onOpenItem }: { message: StoryMessage; me: Who; onClose: () => void; onOpenItem?: (mark: StoryMark, reply: StoryMessage) => void }) {
  return (
    <Thread
      title="Thread"
      onClose={onClose}
      closeLabel="Close thread"
      start={{ id: message.id, author: { name: message.author.name }, time: formatTimestamp(NOW - message.ago, NOW), at: NOW - message.ago, words: message.text }}
      box={<ConversationBox kind="reply" onSend={async () => ({ accepted: true })} contextLabel={`Reply to ${message.author.name}`} />}
    >
      {message.replies?.map((r) => (
        <InHeader key={r.id} label={drawsLine(r.mark) && r.mark ? <MarkLabel mark={r.mark} me={me} onOpen={onOpenItem && (() => onOpenItem(r.mark!, r))} /> : null}>
          <ReplyCard messageId={r.id} authorName={r.author.name} timestamp={formatTimestamp(NOW - r.ago, NOW)} createdAtMs={NOW - r.ago} body={r.text} canEditAndDelete={r.author.key === me.key} />
        </InHeader>
      ))}
    </Thread>
  )
}

/** A topic's or a DM's conversation as Peek's file page draws it: the kit's ConversationLayout, two columns, under the page's bar. */
export function Conversation({ title, messages, me = MIKY, privateRoom = false, about, dm = false, notice, openThread, openItem, typedStart, typedAbove, deleted }: {
  title: string
  /** The message box starts already marked, as after typing a symbol and Enter. */
  typedStart?: MarkWord
  /** The mark's heading sits above the box, which takes its colour, instead of inside it (Miky's second trial). */
  typedAbove?: boolean
  messages: StoryMessage[]
  /** Who is signed in: their own messages offer Edit and Delete. */
  me?: Who
  privateRoom?: boolean
  /** What its items are about: the topic's project. */
  about?: string
  dm?: boolean
  /** Start with the notice of a mark just made. */
  notice?: MarkWord
  /** Start with this message's thread open in the right column. */
  openThread?: string
  /** Start with this message's item open in the right column, as after a press on its label. */
  openItem?: string
  /** Start with a deleted highlight open, as its Activity line opens it for its marker and its message's author. */
  deleted?: { message: string; mark: StoryMark; by: Who; reason?: string }
}) {
  const [open, setOpen] = useState<string | undefined>(openThread)
  // The item a label opened, in the thread's column; `from` is the thread it was opened from, which ← brings back.
  const [item, setItem] = useState<{ item: Item; from?: string; deleted?: { by: Who; reason?: string } } | undefined>(() => {
    if (deleted) {
      const m = messages.find((x) => x.id === deleted.message)
      return m && { item: itemOf(deleted.mark, m, title), deleted }
    }
    const m = messages.find((x) => x.id === openItem)
    return m?.mark ? { item: itemOf(m.mark, m, title) } : undefined
  })
  const showItem = (mark: StoryMark, message: StoryMessage, from?: string) => (setItem({ item: itemOf(mark, message, title), from }), setOpen(undefined))
  const items = messages.map((m) => ({
    id: m.id,
    day: formatDateLabel(NOW - m.ago, NOW),
    // The whole thread, every reply, each marked one wearing its label beside its time as in the feed.
    thread: m.replies ? () => <WholeThread message={m} me={me} onClose={() => setOpen(undefined)} onOpenItem={(mark, r) => showItem(mark, r, m.id)} /> : undefined,
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
    <MarkingProvider messages={messages} privateRoom={privateRoom} me={me} about={about} notice={notice} onOpen={(id) => (setItem(undefined), setOpen((o) => (o === id ? undefined : id)))} onOpenItem={(mark, m) => showItem(mark, m)}>
      <ConversationLayout
        threads="beside"
        open={open}
        onOpenChange={(id) => (setItem(undefined), setOpen(id))}
        aside={item && <ItemBeside item={item.item} deleted={item.deleted} onBack={item.from ? () => (setOpen(item.from), setItem(undefined)) : undefined} onClose={() => setItem(undefined)} />}
        title={title}
        header={<PageHeader title={title} leading={<TopicState type={dm ? 'DM' : 'topic'} status={dm ? 'default' : 'unresolved'} />} />}
        items={items}
        box={<TypedBox contextLabel={title} start={typedStart} above={typedAbove} />}
        empty={<EmptyState message="No messages yet" />}
      />
    </MarkingProvider>
  )
}

/**
 * The real message box with marking as you write (trial, Miky 19 Nov): `?` alone on the first line and Enter, or
 * Ctrl/⌘ + . and a symbol, puts the word's label at the message's start, where Peek's box already draws a highlight
 * tag (`extensions/highlight.tsx`, dormant since 2 Nov); the build revives that tag with the eight words.
 */
function TypedBox({ contextLabel, start, above = false }: { contextLabel: string; start?: MarkWord; above?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const chip = useRef<HTMLSpanElement>(null)
  const [word, setWord] = useState<MarkWord | undefined>(start)
  const [at, setAt] = useState<{ top: number; left: number; room: number }>()
  const has = useRef(word)
  has.current = word
  const picker = useTypedMark(box, { block: '.ProseMirror > p', firstOnly: true, onMark: (w) => setWord(w), onUnmark: () => (has.current ? (setWord(undefined), true) : false) })
  useLayoutEffect(() => {
    const p = box.current?.querySelector('.ProseMirror')
    if (above || !word || !p || !box.current) return setAt(undefined)
    const b = box.current.getBoundingClientRect()
    const r = p.getBoundingClientRect()
    setAt({ top: r.top - b.top, left: r.left - b.left, room: (chip.current?.offsetHeight ?? 20) + 6 })
  }, [word, above])
  // The model's guess while you write (Miky, 19 Nov), read when you pause; a ✕ on it keeps that word away for this draft.
  const [guess, setGuess] = useState<{ word: MarkWord; confidence: number }>()
  const [dropped, setDropped] = useState<MarkWord>()
  useEffect(() => {
    const r = box.current
    if (!above || !r) return
    let t: ReturnType<typeof setTimeout>
    const read = () => (clearTimeout(t), (t = setTimeout(() => setGuess(suggestFor(r.querySelector('.ProseMirror')?.textContent ?? '')), 600)))
    r.addEventListener('input', read)
    return () => (r.removeEventListener('input', read), clearTimeout(t))
  }, [above])
  if (above) {
    // The second trial (Miky, 19 Nov): the mark is a property on top of the message, so its heading sits above the
    // box, outside it, and the box's border takes the word's colour. Marking halfway through a message moves no text.
    const offered = !word && guess && guess.word !== dropped ? guess : undefined
    const sure = offered && offered.confidence >= SURE
    const shown = word ?? (sure ? offered.word : undefined)
    return (
      <div ref={box} className="flex flex-col gap-1" data-typed-box>
        {shown && (
          <>
            <style>{`[data-typed-box] .border-border-field{border-color:${wordTone(shown, 'borderColor').borderColor} !important}`}</style>
            <span className="flex items-center gap-1 px-1">
              <span className="flex items-center gap-1 text-caption font-medium" style={wordTone(shown)}>
                {wordIcon(shown, 14)}
                {shown}
              </span>
              {/* A sure guess marks by default; the sparkle says it was suggested, and ✕ drops it before anything is sent. */}
              {!word && (
                <WithTooltip label="Suggested from what you wrote" wrapperClassName="flex">
                  <IconSparkles size={14} stroke={1.5} className="text-text-muted" />
                </WithTooltip>
              )}
              <IconButton variant="muted" tooltip="Remove the mark" aria-label="Remove the mark" onClick={() => (word ? setWord(undefined) : setDropped(shown))}>
                <IconX size={14} stroke={1.5} />
              </IconButton>
            </span>
          </>
        )}
        {offered && !sure && (
          // An unsure guess is only offered: one press marks it; ignored, the message goes unmarked.
          <span className="flex px-1 text-caption text-text-muted">
            <Card fill="none" hover="fill" quietUntilHover className="-mx-1 flex items-center gap-1 px-1" onClick={() => setWord(offered.word)}>
              <IconSparkles size={14} stroke={1.5} />
              <span style={wordTone(offered.word)} className="flex opacity-70">
                {wordIcon(offered.word, 14)}
              </span>
              {offered.word}?
            </Card>
          </span>
        )}
        <ConversationBox onSend={async () => (setWord(undefined), setGuess(undefined), setDropped(undefined), { accepted: true })} contextLabel={contextLabel} />
        {picker}
      </div>
    )
  }
  // The label is its own row, a heading over the message, and the text (or the placeholder) starts on the line below
  // (Miky, 19 Nov): a sent message shows the word in its header, never inside its text, so the box matches that.
  return (
    <div ref={box} className="relative" data-typed-box>
      {at && <style>{`[data-typed-box] .ProseMirror{padding-top:${at.room}px}[data-typed-box] [data-composer-editor] > .pointer-events-none{top:${at.room}px}`}</style>}
      <ConversationBox onSend={async () => (setWord(undefined), { accepted: true })} contextLabel={contextLabel} />
      {word && (
        <span ref={chip} className={cn(INLINE_CHIP_CLASSES, 'absolute font-medium')} style={{ top: at?.top ?? 0, left: at?.left ?? 0, ...wordTone(word) }}>
          {wordIcon(word, 14)}
          {word}
        </span>
      )}
      {picker}
    </div>
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
function DeciderLine({ by, title, place, at, verb = 'wrote a decision in your name' }: { by: Who; title: string; place: string; at: number; verb?: string }) {
  return (
    <Card href="#" fill="none" quietUntilHover hover="fill" className="flex min-w-0 flex-col gap-0.5 p-2" data-decider-line>
      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <span className="flex min-w-0 shrink-0 text-h5 leading-tight text-text-primary">
          <Person size={16} name={by.name} />
        </span>
        <span className="truncate">{verb}</span>
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
export function DeciderTopicsColumn({ title, ago, by = MIKY, verb }: { title: string; ago: number; by?: Who; verb?: string }) {
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
          preview={<DeciderLine by={by} title={title} place={titleOf(lit)} at={NOW - ago} verb={verb} />}
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
