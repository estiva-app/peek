import { IconLock } from '@tabler/icons-react'
import { Tabs, type TabDef } from '@estiva-app/ui'

/**
 * Peek's topic tabs: the shared Tabs at its `small` size — Peek's own
 * geometry, moved into @estiva-app/ui (2026-09-01) — with the topic tab set
 * as the default. The one visual change is ruled, not accidental: the
 * selected tab is the neutral fill, not the accent tint (Katerina,
 * 2026-09-01 — one look for every app).
 */
export type TopicTab = 'conversations' | 'timeline' | 'huddles'

const DEFAULT_TABS: TabDef<TopicTab>[] = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'huddles', label: 'Huddles', icon: <IconLock size={16} stroke={1.5} /> },
  { id: 'timeline', label: 'Timeline' },
]

interface TopicTabsProps {
  activeTab: TopicTab
  onTabChange: (tab: TopicTab) => void
  tabs?: TabDef<TopicTab>[]
  className?: string
}

export function TopicTabs({ activeTab, onTabChange, tabs = DEFAULT_TABS, className }: TopicTabsProps) {
  return <Tabs tabs={tabs} active={activeTab} onChange={onTabChange} size="small" className={className} />
}
