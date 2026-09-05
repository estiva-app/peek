import { EnterHint, MenuItem, MenuPanel, MenuSection } from '@estiva-app/ui'
import { TopicState } from './TopicState'
import { useIsTopicResolved } from '@/api'
import { type Topic } from '@/api'

/**
 * The topic picker the composer's #-mention opens. Everything here is the
 * shared package's: the `MenuPanel` box, the `MenuSection`, the `MenuItem`
 * rows and the `EnterHint` — the picker row that TopicMenu, MentionMenu, the
 * files menu and the launcher each hand-rolled before 2026-09-01.
 *
 * Rows are the DEFAULT size, not `tall` (2026-09-05): a topic is one line of
 * text beside a 16px state icon, and `tall` is for the row carrying a second
 * line. The `[` menu's topic rows say the same thing the same way.
 */
export function TopicMenu({
  topics,
  highlight,
  onSelect,
  onHighlightChange,
}: {
  topics: Topic[]
  highlight: number
  onSelect: (topic: Topic) => void
  onHighlightChange: (index: number) => void
}) {
  const isTopicResolved = useIsTopicResolved()
  if (topics.length === 0) return null

  return (
    <MenuPanel className="w-fit min-w-[420px] overflow-hidden">
        {/* `default`, not `tall`: a topic row is one line — there is no
            description under it, and `tall` exists for the row that has one
            (Katerina, 2026-09-05). The heading moves to px-2 with its rows. */}
        <MenuSection label="Topics" className="px-2">
          {topics.map((topic, i) => (
            <MenuItem
              key={topic.id}
              leading={<TopicState type="topic" status={isTopicResolved(topic.id) ? 'resolved' : 'unresolved'} />}
              label={topic.title}
              selected={i === highlight}
              hint={<EnterHint target="#topic" />}
              onMouseEnter={() => onHighlightChange(i)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(topic)
              }}
            />
          ))}
        </MenuSection>
    </MenuPanel>
  )
}
