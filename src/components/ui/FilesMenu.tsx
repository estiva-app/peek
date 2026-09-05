import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { EnterHint, MenuItem, MenuPanel, MenuSection } from '@estiva-app/ui'
import { TopicState } from './TopicState'
import { useIsTopicResolved } from '@/api'
import { type Topic } from '@/api'

/**
 * The picker `[` opens: the topics you can reference.
 *
 * It used to offer three sections — Apps (a Figma category you could drill
 * into) and Documents beside Topics — built on invented files. Those only ever
 * appeared in mock mode, so the menu under review was never the menu the app
 * drew, and they were retired with their drill-in level on 2026-09-05
 * (Katerina). `APP_FILES` / `DOCUMENT_FILES` stay in `src/data`: MessageBody
 * still resolves them, so file references in messages already sent keep
 * working, and the `fileMention` node they insert into is untouched.
 *
 * The shape is deliberately one flat list again. If files become real, a
 * second section returns as a `MenuSection` beside this one — not as the
 * two-level drill-in, which was the part that never carried its weight.
 */

export type FilesMenuItem = { kind: 'topic'; data: Topic }

export type FilesMenuRef = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface FilesMenuProps {
  items: FilesMenuItem[]
  query: string
  onSelect: (item: FilesMenuItem) => void
}

function filterItems(items: FilesMenuItem[], query: string): FilesMenuItem[] {
  const q = query.toLowerCase()
  if (!q) return items
  return items.filter((i) => i.data.title.toLowerCase().includes(q))
}

export const FilesMenu = forwardRef<FilesMenuRef, FilesMenuProps>(({ items, query, onSelect }, ref) => {
  const [highlight, setHighlight] = useState(0)
  const isTopicResolved = useIsTopicResolved()

  const shown = filterItems(items, query)

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

  return (
    <MenuPanel className="max-h-[360px] w-[658px] overflow-y-auto">
      <MenuSection label="Topics" className="px-2">
        {shown.map((item, i) => (
          <MenuItem
            key={item.data.id}
            // `default`, not `tall`: a topic is one line beside a 16px state
            // icon, and `tall` is for the row that carries a second line.
            ref={i === highlight ? scrollRef : undefined}
            leading={<TopicState type="topic" status={isTopicResolved(item.data.id) ? 'resolved' : 'unresolved'} />}
            label={item.data.title}
            selected={i === highlight}
            hint={<EnterHint />}
            onMouseEnter={() => setHighlight(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(item)
            }}
          />
        ))}
      </MenuSection>
    </MenuPanel>
  )
})
FilesMenu.displayName = 'FilesMenu'
