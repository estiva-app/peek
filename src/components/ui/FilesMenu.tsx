import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { IconMessage } from '@tabler/icons-react'
import { EnterHint, MenuItem, MenuPanel, MenuSection } from '@estiva-app/ui'
import { TopicState } from './TopicState'
import { useIsTopicResolved } from '@/api'
import { type Topic } from '@/api'
import { previewText } from '@/lib/textParsing'
import type { ConversationMessage } from '@/lib/conversationRegistry'

/**
 * The picker `[` opens: the topics you can reference, and the messages on
 * screen (RIC-11).
 *
 * It used to offer three sections — Apps (a Figma category you could drill
 * into) and Documents beside Topics — built on invented files. Those only ever
 * appeared in mock mode, so the menu under review was never the menu the app
 * drew, and they were retired with their drill-in level on 2026-09-05
 * (Katerina). `APP_FILES` / `DOCUMENT_FILES` stay in `src/data`: MessageBody
 * still resolves them, so file references in messages already sent keep
 * working, and the `fileMention` node they insert into is untouched.
 *
 * Messages are the second section that note said would return "as a
 * `MenuSection` beside this one — not as the two-level drill-in". A message is
 * a file in the sense that matters here (Miky, 2026-09-02: *"everything you
 * mention … is basically a file. Even things like different topic, message, or
 * even specific person"*), and it is offered from the same key.
 */

export type FilesMenuItem =
  | { kind: 'topic'; data: Topic }
  | { kind: 'message'; data: ConversationMessage }

export type FilesMenuRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface FilesMenuProps {
  items: FilesMenuItem[]
  query: string
  onSelect: (item: FilesMenuItem) => void
}

/** Where the picker will find one message among many on screen. */
const MESSAGE_LIMIT = 6

function matches(item: FilesMenuItem, q: string): boolean {
  if (item.kind === 'topic') return item.data.title.toLowerCase().includes(q)
  // By what was said or who said it — "what Ada said" is found either way.
  return item.data.body.toLowerCase().includes(q) || item.data.author.toLowerCase().includes(q)
}

function filterItems(items: FilesMenuItem[], query: string): FilesMenuItem[] {
  const q = query.toLowerCase()
  const shown = q ? items.filter((i) => matches(i, q)) : items
  /*
    Topics first and messages capped, newest last as the thread shows them. A
    topic list is bounded by the workspace; a thread is not, and a menu that
    grew with it would put the topics somebody actually typed for below a
    hundred rows of prose.
  */
  const topics = shown.filter((i) => i.kind === 'topic')
  const messages = shown.filter((i) => i.kind === 'message').slice(-MESSAGE_LIMIT)
  return [...topics, ...messages]
}

export const FilesMenu = forwardRef<FilesMenuRef, FilesMenuProps>(({ items, query, onSelect }, ref) => {
  const [highlight, setHighlight] = useState(0)
  const isTopicResolved = useIsTopicResolved()

  const shown = filterItems(items, query)
  const topics = shown.filter((i): i is Extract<FilesMenuItem, { kind: 'topic' }> => i.kind === 'topic')
  const messages = shown.filter((i): i is Extract<FilesMenuItem, { kind: 'message' }> => i.kind === 'message')

  useEffect(() => setHighlight(0), [query])

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (event.key === 'ArrowDown') {
        setHighlight((h) => Math.min(h + 1, shown.length - 1))
        return true
      }
      if (event.key === 'ArrowUp') {
        setHighlight((h) => Math.max(h - 1, 0))
        return true
      }
      if (event.key === 'Enter') {
        const item = shown[highlight]
        if (!item) return false
        onSelect(item)
        return true
      }
      return false
    },
  }))

  const scrollRef = useCallback((el: HTMLElement | null) => {
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (shown.length === 0) return null

  // One highlight index across both sections, so the arrow keys walk the
  // whole menu; a message's index continues from the last topic's.
  const row = (item: FilesMenuItem, i: number, leading: React.ReactNode, label: string, key: string) => (
    <MenuItem
      key={key}
      ref={i === highlight ? scrollRef : undefined}
      leading={leading}
      label={label}
      selected={i === highlight}
      hint={<EnterHint />}
      onMouseEnter={() => setHighlight(i)}
      onMouseDown={(e) => {
        e.preventDefault()
        onSelect(item)
      }}
    />
  )

  return (
    <MenuPanel className="max-h-[360px] w-[658px] overflow-y-auto">
      {topics.length > 0 && (
        <MenuSection label="Topics" className="px-2">
          {topics.map((item, i) =>
            row(
              item,
              i,
              // `default`, not `tall`: a topic is one line beside a 16px state
              // icon, and `tall` is for the row that carries a second line.
              <TopicState type="topic" status={isTopicResolved(item.data.id) ? 'resolved' : 'unresolved'} />,
              item.data.title,
              `topic-${item.data.id}`,
            ),
          )}
        </MenuSection>
      )}
      {messages.length > 0 && (
        <MenuSection label="Messages" className="px-2">
          {messages.map((item, i) =>
            row(
              item,
              topics.length + i,
              <IconMessage size={16} stroke={1.5} className="text-text-secondary" />,
              // The author and the opening words, marks stripped — the same
              // caption the chip wears once picked, so nothing changes shape.
              `${item.data.author}: ${previewText(item.data.body)}`,
              `message-${item.data.eventId ?? item.data.id}`,
            ),
          )}
        </MenuSection>
      )}
    </MenuPanel>
  )
})
FilesMenu.displayName = 'FilesMenu'
