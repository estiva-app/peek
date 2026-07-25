import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { IconChevronRight, IconPlus, IconSortDescending } from '@tabler/icons-react'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { Divider } from '@/components/ui/Divider'
import { SectionLabel } from '@/components/ui/SectionHeader'
import { IconButton } from '@/components/ui/IconButton'
import { PersonRow } from '@/components/ui/PersonRow'
import { ScreenerSection } from '@/components/ScreenerSection'
import { AddToOpenWorkDialog } from '@/components/AddToOpenWorkDialog'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import { useTopicView } from '@/components/views/useTopicView'
import {
  dmNameById,
  useUnread,
  hasConvex,
  useScreenerItems,
  useDeskItems,
  useDeskLoading,
  useTopics,
  useIsTopicResolved,
  useCreateTopicFromDm,
  usePeekActions,
  useStarred,
  type OpenWorkItem,
} from '@/api'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { StartTopicResult } from '@/components/CreateTopicDialog'

type SectionKey = 'urgent' | 'openWork' | 'starred'

type Selected =
  | { kind: 'dm'; dmId: string; dmName: string; section: SectionKey }
  | { kind: 'topic'; topicId: string; topicTitle: string; topicResolved: boolean; section: SectionKey }

export function DeskPage() {
  const { topicHasUnread, dmHasUnread, topicIsUrgent, dmIsUrgent } = useUnread()
  const navigate = useNavigate()
  const location = useLocation()
  const { showToast } = useToast()
  const { state: debug } = useDebug()
  const { entries: starredAll, isDmStarred, isTopicStarred, toggleDm, toggleTopic, isLoading: starredLoading } = useStarred()
  const deskLoading = useDeskLoading()
  const actions = usePeekActions()
  const TOPICS = useTopics()
  const createTopicFromDm = useCreateTopicFromDm()
  const isTopicResolved = useIsTopicResolved()
  const allScreenerItems = useScreenerItems()
  const { openWork: OPEN_WORK_ITEMS, urgent: URGENT_ITEMS } = useDeskItems()
  const [selected, setSelected] = useState<Selected | null>(null)
  const [dismissedScreenerIds, setDismissedScreenerIds] = useState<Set<string>>(new Set())
  const [dismissedOpenWorkIds, setDismissedOpenWorkIds] = useState<Set<string>>(new Set())
  const [showAddToOpenWork, setShowAddToOpenWork] = useState(false)
  const [starredExpanded, setStarredExpanded] = useState(true)

  // The 1–2 item caps are a demo-composition affordance for the mock dataset.
  // With a real backend the Screener IS the inbox and Urgent is real — capping
  // them would silently hide incoming messages.
  const screenerItems = (hasConvex ? allScreenerItems : allScreenerItems.slice(0, debug.desk.screenerItemsCount))
    .filter((i) => !dismissedScreenerIds.has(i.id))

  const urgentItems = debug.desk.showUrgent
    ? hasConvex
      ? URGENT_ITEMS
      : URGENT_ITEMS.slice(0, debug.desk.urgentItemsCount)
    : []

  // Section-level unread visibility (per-page debug toggles).
  const showTopicUnreads = debug.unreads.topics
  const showPeopleUnreads = debug.unreads.people

  // Open work holds topics and (via Screener "Open") DMs. Sort unread first
  // when unreads are visible. Filter out items dismissed via the row's X.
  const openWorkUnread = (i: OpenWorkItem) =>
    i.kind === 'dm' ? dmHasUnread(i.dmId) : topicHasUnread(i.topicId)
  const baseOpenWork = (debug.desk.openWorkHasData ? OPEN_WORK_ITEMS : [])
    .filter((i) => !dismissedOpenWorkIds.has(i.id))
  const openWorkItems = showTopicUnreads
    ? [...baseOpenWork].sort((a, b) => Number(openWorkUnread(b)) - Number(openWorkUnread(a)))
    : baseOpenWork

  const dismissOpenWork = (id: string) => {
    // Removing the conversation you're looking at clears the stale selection —
    // the right panel falls back to "No conversation selected" (QA #2.2).
    const item = openWorkItems.find((i) => i.id === id)
    const wasSelected =
      item != null &&
      selected != null &&
      (item.kind === 'dm'
        ? selected.kind === 'dm' && selected.dmId === item.dmId
        : selected.kind === 'topic' && selected.topicId === item.topicId)
    if (wasSelected) setSelected(null)
    setDismissedOpenWorkIds((prev) => new Set([...prev, id]))
    if (item && item.kind !== 'dm') {
      // Topic rows go through the overlay-aware action: it marks the topic
      // removed in the session overlay — so the "+" picker offers it again
      // immediately and the overlay can't resurrect the row under its
      // synthetic id while the reactive query catches up — and deletes the
      // server row by topic key (row ids don't exist for overlay rows).
      actions.removeTopicFromOpenWork(item.topicId)
    } else {
      actions.removeOpenWorkItem(id)
    }
  }

  // Starred mixes DMs and topics. Sort each entry's unreadness based on its kind's toggle.
  const baseStarred = debug.desk.starredHasData ? starredAll : []
  const starredEntries = (showTopicUnreads || showPeopleUnreads)
    ? [...baseStarred].sort((a, b) => {
        const aUnread = a.kind === 'dm' ? (showPeopleUnreads && dmHasUnread(a.dmId)) : (showTopicUnreads && topicHasUnread(a.topicId))
        const bUnread = b.kind === 'dm' ? (showPeopleUnreads && dmHasUnread(b.dmId)) : (showTopicUnreads && topicHasUnread(b.topicId))
        return Number(bUnread) - Number(aUnread)
      })
    : baseStarred

  // Selection dedup: the section that owns the selected highlight is wherever
  // the user last clicked. So clicking the same item from a different section
  // moves the highlight to that section.
  const selectionAnchor: SectionKey | null = selected?.section ?? null

  const dismissScreener = (id: string) => {
    setDismissedScreenerIds((prev) => new Set([...prev, id]))
    actions.dismissScreenerItem(id)
  }

  /** "Open" → move the item into Open work. */
  const openScreener = (id: string) => {
    setDismissedScreenerIds((prev) => new Set([...prev, id]))
    actions.addScreenerToOpenWork(id)
  }

  /** "Later" hides the item now; it reappears after the chosen reminder time. */
  const laterScreener = (id: string, untilMs: number) => {
    setDismissedScreenerIds((prev) => new Set([...prev, id]))
    actions.snoozeScreenerItem(id, untilMs)
  }

  const selectTopic = (topicId: string, section: SectionKey) => {
    const topic = TOPICS?.find((t) => t.id === topicId)
    if (!topic) return
    setSelected({ kind: 'topic', topicId, topicTitle: topic.title, topicResolved: isTopicResolved(topicId), section })
  }
  const selectDm = (dmId: string, fallbackName: string, section: SectionKey) => {
    const dmName = dmNameById(dmId) ?? fallbackName
    setSelected({ kind: 'dm', dmId, dmName, section })
  }

  // On Desk, unstarring clears selection unless the item is still reachable via
  // Urgent (DMs or topics) or Open work (topics only). If the selection was
  // anchored to Starred, migrate it to the next section that still has the item.
  // Starring is harmless.
  const handleToggleStarredOnDesk = () => {
    if (!selected) return
    if (selected.kind === 'dm') {
      const wasStarred = isDmStarred(selected.dmId)
      toggleDm({ dmId: selected.dmId, name: selected.dmName })
      if (!wasStarred) return
      const inUrgent = urgentItems.some((u) => u.kind === 'dm' && u.dmId === selected.dmId)
      if (!inUrgent) setSelected(null)
      else if (selected.section === 'starred') setSelected({ ...selected, section: 'urgent' })
    } else {
      const wasStarred = isTopicStarred(selected.topicId)
      toggleTopic({
        topicId: selected.topicId,
        title: selected.topicTitle,
        topicStatus: selected.topicResolved ? 'resolved' : 'unresolved',
      })
      if (!wasStarred) return
      const inUrgent = urgentItems.some((u) => u.kind === 'topic' && u.topicId === selected.topicId)
      const inOpenWork = openWorkItems.some((i) => i.kind !== 'dm' && i.topicId === selected.topicId)
      if (!inUrgent && !inOpenWork) setSelected(null)
      else if (selected.section === 'starred') {
        setSelected({ ...selected, section: inUrgent ? 'urgent' : 'openWork' })
      }
    }
  }

  const handleStartTopicFromDm = (dmId: string, dmName: string, seedMessageId: string, data: StartTopicResult) => {
    const { topicId } = createTopicFromDm({
      title: data.title,
      dmId,
      dmName,
      invitees: data.invitees,
      seedMessageId,
    })
    const previousPath = `${location.pathname}${location.search}`
    navigate(`/topics/${topicId}`)
    showToast({
      label: 'Topic created',
      actionLabel: 'Back to conversation',
      onAction: () => navigate(previousPath),
    })
  }

  // Both hooks always run - each only does meaningful work when its id is set
  const dmView = useDmConversationView({
    dmId: selected?.kind === 'dm' ? selected.dmId : null,
    dmName: selected?.kind === 'dm' ? selected.dmName : undefined,
    onToggleStarred: selected?.kind === 'dm' ? handleToggleStarredOnDesk : undefined,
    showUnreads: showPeopleUnreads,
    onStartTopicFromDm: handleStartTopicFromDm,
  })
  const topicView = useTopicView({
    topicId: selected?.kind === 'topic' ? selected.topicId : null,
    topicTitle: selected?.kind === 'topic' ? selected.topicTitle : undefined,
    onToggleStarred: selected?.kind === 'topic' ? handleToggleStarredOnDesk : undefined,
    showUnreads: showTopicUnreads,
  })

  const rightPanel = selected?.kind === 'dm' ? dmView.rightPanel : topicView.rightPanel
  const threadPanel = selected?.kind === 'dm' ? dmView.threadPanel : topicView.threadPanel

  return (
    <>
    <AppShell
      leftPanel={
        <div className="flex flex-col h-full">
          <ContainerHeader title="Desk" />
          <div className="flex-1 overflow-y-auto pt-4 pb-3 px-3 flex flex-col gap-1">
            {(deskLoading || starredLoading) ? (
            <SkeletonSidebarList rows={8} />
            ) : (
            <>
            {/* Screener - only shows when toggled on AND has items */}
            {debug.desk.showScreener && screenerItems.length > 0 && (
              <>
                <ScreenerSection
                  items={screenerItems}
                  onOpen={openScreener}
                  onDismiss={dismissScreener}
                  onLater={laterScreener}
                />
                <Divider className="my-2" />
              </>
            )}

            {/* Urgent - only shows when toggled on AND has items */}
            {urgentItems.length > 0 && (
              <>
                <div className="flex flex-col">
                  <div className="flex h-[32px] items-center px-2">
                    <SectionLabel>Urgent</SectionLabel>
                  </div>
                  <div className="flex flex-col gap-0.5 mt-1">
                    {urgentItems.map((item) =>
                      item.kind === 'dm' ? (
                        <PersonRow
                          key={item.id}
                          name={item.name}
                          type="DM"
                          avatarSrc={item.avatarSrc}
                          isUnread
                          isUrgent
                          isSelected={
                            selectionAnchor === 'urgent' &&
                            selected?.kind === 'dm' &&
                            selected.dmId === item.dmId
                          }
                          onClick={() => selectDm(item.dmId, item.name, 'urgent')}
                        />
                      ) : (
                        <PersonRow
                          key={item.id}
                          name={item.title}
                          type="topic"
                          topicStatus={isTopicResolved(item.topicId) ? 'resolved' : 'unresolved'}
                          isUnread
                          isUrgent
                          isSelected={
                            selectionAnchor === 'urgent' &&
                            selected?.kind === 'topic' &&
                            selected.topicId === item.topicId
                          }
                          onClick={() => selectTopic(item.topicId, 'urgent')}
                        />
                      )
                    )}
                  </div>
                </div>
                <Divider className="my-2" />
              </>
            )}

            {/* Open work */}
            <div className="flex flex-col">
              <div className="flex h-[32px] items-center justify-between px-2">
                <SectionLabel>Open work</SectionLabel>
                <div className="flex items-center gap-1">
                  <IconButton aria-label="Sort" tooltip="Sort by">
                    <IconSortDescending size={16} stroke={1.5} />
                  </IconButton>
                  <IconButton aria-label="Add" tooltip="Add to Open work" onClick={() => setShowAddToOpenWork(true)}>
                    <IconPlus size={16} stroke={1.5} />
                  </IconButton>
                </div>
              </div>
              {openWorkItems.length === 0 ? (
                <p className="px-2 py-1 text-[12px] text-text-muted leading-[1.4]">
                  Organize what you want to read, write, work on now, soon, or simply keep it open for the very first moment once you have time for it.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5 mt-1">
                  {openWorkItems.map((item) =>
                    item.kind === 'dm' ? (
                      <PersonRow
                        key={item.id}
                        name={item.name}
                        type="DM"
                        avatarSrc={item.avatarSrc}
                        isUnread={(showPeopleUnreads && dmHasUnread(item.dmId)) || item.isUnread}
                        isSelected={
                          selectionAnchor === 'openWork' &&
                          selected?.kind === 'dm' &&
                          selected.dmId === item.dmId
                        }
                        onClick={() => selectDm(item.dmId, item.name, 'openWork')}
                        onRemove={() => dismissOpenWork(item.id)}
                      />
                    ) : (
                      <PersonRow
                        key={item.id}
                        name={item.title}
                        type="topic"
                        topicStatus={isTopicResolved(item.topicId) ? 'resolved' : 'unresolved'}
                        isUnread={(showTopicUnreads && topicHasUnread(item.topicId)) || item.isUnread}
                        isSelected={
                          selectionAnchor === 'openWork' &&
                          selected?.kind === 'topic' &&
                          selected.topicId === item.topicId
                        }
                        onClick={() => selectTopic(item.topicId, 'openWork')}
                        onRemove={() => dismissOpenWork(item.id)}
                      />
                    )
                  )}
                </div>
              )}
            </div>

            <Divider className="my-2" />

            {/* Starred */}
            <div className="flex flex-col">
              <div
                className="group flex h-[32px] items-center justify-between px-2 rounded-lg cursor-pointer transition-colors hover:bg-bg-hover"
                onClick={() => setStarredExpanded((v) => !v)}
              >
                <div className="flex items-center gap-1">
                  <IconChevronRight
                    size={12}
                    stroke={1.5}
                    className={cn(
                      'text-text-secondary transition-transform duration-150',
                      starredExpanded && 'rotate-90'
                    )}
                  />
                  <SectionLabel>Starred</SectionLabel>
                </div>
              </div>
              {starredExpanded && (
                starredEntries.length === 0 ? (
                  <p className="px-2 py-1 text-[12px] text-text-muted leading-[1.4]">
                    Favorite the conversations of People or Topics you interact mostly with
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5 mt-1">
                    {starredEntries.map((entry) =>
                      entry.kind === 'dm' ? (
                        <PersonRow
                          key={entry.id}
                          name={entry.name}
                          type="DM"
                          avatarSrc={entry.avatarSrc}
                          isUnread={(showPeopleUnreads && dmHasUnread(entry.dmId)) || entry.isUnread}
                          isSelected={
                            selectionAnchor === 'starred' &&
                            selected?.kind === 'dm' &&
                            selected.dmId === entry.dmId
                          }
                          onClick={() => selectDm(entry.dmId, entry.name, 'starred')}
                        />
                      ) : (
                        <PersonRow
                          key={entry.id}
                          name={entry.title}
                          type="topic"
                          topicStatus={isTopicResolved(entry.topicId) ? 'resolved' : 'unresolved'}
                          isUnread={(showTopicUnreads && topicHasUnread(entry.topicId)) || entry.isUnread}
                          isSelected={
                            selectionAnchor === 'starred' &&
                            selected?.kind === 'topic' &&
                            selected.topicId === entry.topicId
                          }
                          onClick={() => selectTopic(entry.topicId, 'starred')}
                        />
                      )
                    )}
                  </div>
                )
              )}
            </div>

            <Divider className="my-2" />
            </>
            )}
          </div>
        </div>
      }
      rightPanel={rightPanel}
      threadPanel={threadPanel}
    />
    {showAddToOpenWork && (
      <AddToOpenWorkDialog
        onAdd={(topicIds) => actions.addTopicsToOpenWork(topicIds)}
        onClose={() => setShowAddToOpenWork(false)}
      />
    )}
    </>
  )
}
