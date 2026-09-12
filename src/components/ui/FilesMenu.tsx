import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useState } from 'react'
import { IconMessage } from '@tabler/icons-react'
import { EnterHint, MenuItem, MenuSection } from '@estiva-app/ui'
import { TopicState } from './TopicState'
import { useIsTopicResolved } from '@/api'
import { previewText } from '@/lib/textParsing'
import { filterFilesItems, type FilesMenuItem } from './filesMenuItems'

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

export type { FilesMenuItem } from './filesMenuItems'

export type FilesMenuRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface FilesMenuProps {
  items: FilesMenuItem[]
  query: string
  onSelect: (item: FilesMenuItem) => void
}

export const FilesMenu = forwardRef<FilesMenuRef, FilesMenuProps>(({ items, query, onSelect }, ref) => {
  const [highlight, setHighlight] = useState(0)
  const isTopicResolved = useIsTopicResolved()

  const shown = filterFilesItems(items, query)
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

  const base = useId()

  if (shown.length === 0) return null

  // One highlight index across both sections, so the arrow keys walk the
  // whole menu; a message's index continues from the last topic's.
/* A row is an `option` in the popup's listbox (P28): an id for the editor's
   `aria-activedescendant` to point at, `aria-selected` on the highlighted one,
   and `tabIndex={-1}` because focus stays in the text — the row is reached by
   the arrow keys through the editor, never by Tab. `SuggestionPopover` does
   the rest. */
  const row = (item: FilesMenuItem, i: number, leading: React.ReactNode, label: string, key: string) => (
    <MenuItem
      key={key}
      role="option"
      id={`${base}-${i}`}
      aria-selected={i === highlight}
      tabIndex={-1}
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
    <>
      {topics.length > 0 && (
        <div role="group" aria-label="Topics">
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
        </div>
      )}
      {messages.length > 0 && (
        <div role="group" aria-label="Messages">
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
        </div>
      )}
    </>
  )
})
FilesMenu.displayName = 'FilesMenu'
