import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { IconPlus, IconSortDescending } from '@tabler/icons-react'
import { CollapsibleSection, ListColumn } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { useRailClosed } from '@/layouts/railClosed'
import { TopicDetailsDialog } from '@/components/TopicDetailsDialog'
import { Divider } from '@/components/ui/Divider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { ScreenerSection } from '@/components/ScreenerSection'
import { AddToOpenWorkDialog } from '@/components/AddToOpenWorkDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import { useTopicView } from '@/components/views/useTopicView'
import { TopicProjectPanel } from '@/components/TopicProjectPanel'
import { useFolderProject } from '@/api/useFolderProject'
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
  useConversationBadges,
  useOpenWorkFiles,
  type OpenWorkItem,
} from '@/api'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import { filePath } from '@/lib/objectUrl'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useToast } from '@/lib/toast'
import { useTopicPath } from '@/lib/useTopicPath'
import type { StartTopicResult } from '@/components/CreateTopicDialog'

type SectionKey = 'urgent' | 'openWork' | 'starred'

type Selected =
  | { kind: 'dm'; dmId: string; dmName: string; section: SectionKey }
  | { kind: 'topic'; topicId: string; topicTitle: string; topicResolved: boolean; section: SectionKey }

/**
 * The Desk page: the Screener, Urgent, Open work and Starred lists on the left,
 * and the chosen topic or direct message beside them.
 */
export function DeskPage() {
  const railClosed = useRailClosed()
  const { topicHasUnread, dmHasUnread, topicIsUrgent, dmIsUrgent } = useUnread()
  const navigate = useNavigate()
  const pathForTopic = useTopicPath()
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

  /*
    A file's dot (FOL-34) is the listing's: its own conversation against its own
    marker, and only for what the person follows. `=== true` — an unjudged file
    draws no dot, not a dark one.
  */
  const openWorkFiles = useOpenWorkFiles()
  const { unread: fileUnread } = useConversationBadges(
    OPEN_WORK_ITEMS.flatMap((i) => (i.kind === 'file' ? [i.object] : [])),
  )

  // Open work holds topics, files and (via Screener "Open") DMs. Sort unread
  // first when unreads are visible. Filter out items dismissed via the row's X.
  const openWorkUnread = (i: OpenWorkItem) =>
    i.kind === 'file'
      ? fileUnread[i.object.ref] === true
      : i.kind === 'dm'
        ? dmHasUnread(i.dmId)
        : topicHasUnread(i.topicId)
  const baseOpenWork = (debug.desk.openWorkHasData ? OPEN_WORK_ITEMS : [])
    .filter((i) => !dismissedOpenWorkIds.has(i.id))
  const openWorkItems = showTopicUnreads
    ? [...baseOpenWork].sort((a, b) => Number(openWorkUnread(b)) - Number(openWorkUnread(a)))
    : baseOpenWork

  const dismissOpenWork = (id: string) => {
    // Removing the conversation you're looking at clears the stale selection —
    // the right panel falls back to "No conversation selected" (QA #2.2).
    const item = openWorkItems.find((i) => i.id === id)
    // A file is never selected here — it opens on its own page — so only the
    // other two kinds can leave a stale selection behind.
    const wasSelected =
      item != null &&
      selected != null &&
      item.kind !== 'file' &&
      (item.kind === 'dm'
        ? selected.kind === 'dm' && selected.dmId === item.dmId
        : selected.kind === 'topic' && selected.topicId === item.topicId)
    if (wasSelected) setSelected(null)
    setDismissedOpenWorkIds((prev) => new Set([...prev, id]))
    // Every kind removes by the key the blob holds, never by a row id: since
    // SHR-9 the list comes from the relay and the rows carry synthetic ids. The
    // action marks the removal in the session overlay — so the "+" picker offers
    // a topic again immediately — and deletes the Convex row the Screener's
    // de-duplication still reads (a file has none).
    if (item && item.kind === 'file') openWorkFiles.remove(item.address)
    else if (item && item.kind === 'dm') actions.removeDmFromOpenWork(item.dmId)
    else if (item) actions.removeTopicFromOpenWork(item.topicId)
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
    const item = screenerItems.find((i) => i.id === id)
    if (!item) return
    setDismissedScreenerIds((prev) => new Set([...prev, id]))
    actions.addScreenerToOpenWork(
      id,
      item.kind === 'file'
        ? { kind: 'file', address: item.address }
        : item.kind === 'dm'
          ? { kind: 'dm', dmId: item.dmId }
          : { kind: 'topic', topicId: item.topicId },
    )
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
      const inOpenWork = openWorkItems.some(
        (i) => i.kind !== 'dm' && i.kind !== 'file' && i.topicId === selected.topicId,
      )
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
    navigate(pathForTopic(topicId))
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
  /**
   * The Folder panel is a property of the topic, not of the page it was opened
   * from — so Desk offers it exactly as Topics does (PEE-3). Without this a
   * topic reached from Desk lost both the panel and the header button that
   * shows it, which read as the topic having no linked project at all.
   */
  const [folderPanelOpen, setFolderPanelOpen] = useState(true)
  /*
    The Folder resolved once for this topic — CON-9.

    Both the conversation and the Folder panel need it: the conversation to know
    which messages belong to a file *under* this one, the panel to draw the
    files and the Activity beneath them. Held here, above both, so there is one
    cross-app read per topic rather than two disagreeing ones.

    `panelBusy` is the panel telling us a change is in flight, so an automatic
    re-read cannot land over it and put the pre-change state back on screen.
  */
  const [panelBusy, setPanelBusy] = useState<string | undefined>()
  const folderProject = useFolderProject(selected?.kind === 'topic' ? selected.topicId : null, panelBusy)
  /** Which topic's details are open. Desk offers the same header menu Topics
   *  does — a topic opened from here is the same topic (PEE-2). */
  const [detailsTopicId, setDetailsTopicId] = useState<string | null>(null)
  const topicView = useTopicView({
    folderProject: folderProject.state,
    topicId: selected?.kind === 'topic' ? selected.topicId : null,
    topicTitle: selected?.kind === 'topic' ? selected.topicTitle : undefined,
    onToggleStarred: selected?.kind === 'topic' ? handleToggleStarredOnDesk : undefined,
    showUnreads: showTopicUnreads,
    onToggleFolderPanel: hasConvex ? () => setFolderPanelOpen((v) => !v) : undefined,
    folderPanelOpen,
    onOpenDetails:
      selected?.kind === 'topic' ? () => setDetailsTopicId(selected.topicId) : undefined,
  })

  const rightPanel = selected?.kind === 'dm' ? dmView.rightPanel : topicView.rightPanel
  /**
   * Same rule as Topics (PEEK-24): the right column is the reply thread when one
   * is open, and the Folder panel otherwise. A thread is what somebody just
   * asked for; the Folder is context they chose to keep.
   *
   * DMs are untouched — they have no Folder to show.
   */
  const threadPanel =
    selected?.kind === 'dm'
      ? dmView.threadPanel
      : (topicView.threadPanel ??
        (hasConvex && folderPanelOpen && selected?.kind === 'topic' && topicView.folderId ? (
          <TopicProjectPanel
            topicKey={selected.topicId}
            folderProject={folderProject.state}
            reload={folderProject.reload}
            onBusyChange={setPanelBusy}
            activity={topicView.activity}
            subFileLabels={topicView.subFileLabels}
            selectedConversationId={topicView.openThreadId}
            onOpenThread={topicView.openThread}
          />
        ) : undefined))

  return (
    <>
    {detailsTopicId && (
      <TopicDetailsDialog topicKey={detailsTopicId} onClose={() => setDetailsTopicId(null)} />
    )}
    <AppShell
      leftPanel={
        <ListColumn title="Desk" collapsed={railClosed}>
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
                <SectionHeader title="Urgent" hover="none" />
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
            {/* The package's section row (UIG-14, 10.2): its actions always
                shown, and the row itself still under the pointer — the
                buttons light up on their own (Katerina, 19 September). */}
            <SectionHeader
              title="Open work"
              showActions="always"
              hover="none"
              actions={[
                // Sort does nothing yet, as before.
                { icon: <IconSortDescending size={16} stroke={1.5} />, tooltip: 'Sort by', onClick: () => {} },
                { icon: <IconPlus size={16} stroke={1.5} />, tooltip: 'Add to Open work', onClick: () => setShowAddToOpenWork(true) },
              ]}
            />
            {openWorkItems.length === 0 ? (
              <p className="px-2 py-1 text-caption leading-snug text-text-muted">
                Organize what you want to read, write, work on now, soon, or simply keep it open for the very first moment once you have time for it.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5 mt-1">
                {openWorkItems.map((item) =>
                  item.kind === 'file' ? (
                    /*
                      A file opens on its own page rather than beside the Desk
                      (FOL-34): its conversation is the file page's, and the
                      Desk's right column draws only a topic or a DM.
                    */
                    <PersonRow
                      key={item.id}
                      name={item.title}
                      type={item.object.kind === KIND_BARE_FILE ? 'topic' : 'file'}
                      isUnread={showTopicUnreads && fileUnread[item.object.ref] === true}
                      onClick={() => navigate(filePath(item.address, item.title))}
                      onRemove={() => dismissOpenWork(item.id)}
                    />
                  ) : item.kind === 'dm' ? (
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

          {/* Starred — the package's CollapsibleSection (§4.8, D42): the same
              32px row, but the title is a button, the rows slide, and this
              browser remembers the fold. It was a hand-drawn copy of
              ui/StarredSection until 2026-09-10 (Peek scan F10). */}
          <CollapsibleSection title="Starred" storageKey="peek.desk.starred" contentClassName="gap-0.5 mt-1">
            {starredEntries.length === 0 ? (
              // Level with the rows (Katerina, 2026-09-14): each PersonRow pads itself,
              // so the line takes a row's inset here, never on EmptyState.
              <div className="px-2 py-1">
                <EmptyState scope="section" message="Favorite the conversations of People or Topics you interact mostly with" />
              </div>
            ) : (
                  starredEntries.map((entry) =>
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
                  )
            )}
          </CollapsibleSection>

          <Divider className="my-2" />
          </>
          )}
        </ListColumn>
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
