import { IconLock } from '@tabler/icons-react'
import { Tabs, type TabDef } from '@estiva-app/ui'

/**
 * Peek's topic tabs: the shared Tabs at its `small` size — Peek's own
 * geometry, moved into @estiva-app/ui (2026-09-01) — with the topic tab set
 * as the default. The one visual change is ruled, not accidental: the
 * selected tab is the neutral fill, not the accent tint (Katerina,
 * 2026-09-01 — one look for every app).
 */
export type TopicTab = 'conversations' | 'activity' | 'timeline' | 'huddles'

const DEFAULT_TABS: TabDef<TopicTab>[] = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'activity', label: 'Activity' },
  { id: 'huddles', label: 'Huddles', icon: <IconLock size={16} stroke={1.5} /> },
  { id: 'timeline', label: 'Timeline' },
]

/**
 * The two lists CON-9 gives every file, and nothing else — the tab row a topic
 * always shows.
 *
 * `DEFAULT_TABS` is the full set and stays behind the huddle variant that owns
 * it. This pair is unconditional, because Activity is not an extra view: it
 * holds a topic's ticket conversations, which on production is 93% of what used
 * to be in the stream. A tab that appears only under a debug flag would have
 * hidden almost everything in the Folder.
 */
export function conversationTabs(counts: { conversations: number; activity: number }): TabDef<TopicTab>[] {
  /*
    Counts, because this is exactly the case the package's page describes: "a
    muted mono number after the label". Without them the split is invisible
    until you click — a topic whose stream is now short reads as an empty topic
    rather than as one whose discussion is under Activity.

    A count of 0 is still drawn, deliberately. It is an answer, and "Activity 0"
    is the honest way to say a Folder has no other files talking in it.
  */
  return [
    { id: 'conversations', label: 'Conversations', count: counts.conversations },
    { id: 'activity', label: 'Activity', count: counts.activity },
  ]
}

interface TopicTabsProps {
  activeTab: TopicTab
  onTabChange: (tab: TopicTab) => void
  tabs?: TabDef<TopicTab>[]
  className?: string
}

export function TopicTabs({ activeTab, onTabChange, tabs = DEFAULT_TABS, className }: TopicTabsProps) {
  return <Tabs tabs={tabs} active={activeTab} onChange={onTabChange} size="small" className={className} />
}
