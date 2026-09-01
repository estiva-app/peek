import { EnterHint, MenuItem, MenuSection } from '@estiva-app/ui'
import { TopicState } from './TopicState'
import { useIsTopicResolved } from '@/api'
import { type Topic } from '@/api'

/**
 * The topic picker the composer's #-mention opens. Its rows are the shared
 * MenuItem at its tall size (2026-09-01) — the picker row TopicMenu,
 * MentionMenu, the files menu and the launcher all hand-rolled — with the
 * highlight-follow riding through the shared item's props and the shared
 * EnterHint for the "↩ #topic" hint.
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
    <div className="w-fit min-w-[420px] bg-bg-elevated border border-border-default rounded-lg overflow-hidden shadow-lg">
      <div className="p-2">
        <MenuSection label="Topics">
          {topics.map((topic, i) => (
            <MenuItem
              key={topic.id}
              size="tall"
              leading={<TopicState type="topic" status={isTopicResolved(topic.id) ? 'resolved' : 'unresolved'} />}
              label={topic.title}
              selected={i === highlight}
              trailing={i === highlight ? <EnterHint label="#topic" /> : undefined}
              onMouseEnter={() => onHighlightChange(i)}
              onMouseDown={(event) => {
                event.preventDefault()
                onSelect(topic)
              }}
            />
          ))}
        </MenuSection>
      </div>
    </div>
  )
}
