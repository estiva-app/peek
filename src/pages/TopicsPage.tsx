import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { IconMessagePlus, IconLinkOff } from '@tabler/icons-react'
import { AppShell } from '@/layouts/AppShell'
import { TopicDetailsDialog } from '@/components/TopicDetailsDialog'
import { ContainerHeader } from '@/components/ContainerHeader'
import { CreateTopicDialog, type StartTopicResult } from '@/components/CreateTopicDialog'
import { PersonRow } from '@/components/ui/PersonRow'
import { Divider } from '@/components/ui/Divider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTopicView } from '@/components/views/useTopicView'
import { TopicProjectPanel } from '@/components/TopicProjectPanel'
import { useFolderProject } from '@/api/useFolderProject'
import { hasConvex, useUnread, useTopics, useCreateTopic, useDeleteTopic, useIsTopicResolved, useIsTopicMember, useOpenWorkTopicIds, usePeekActions } from '@/api'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useLastSelection } from '@/lib/lastSelection'
import { useToast } from '@/lib/toast'
import { identifierFromRef, topicPath } from '@/lib/objectUrl'
import { useTopicPath } from '@/lib/useTopicPath'

export function TopicsPage() {
  const { topicHasUnread, topicIsUrgent } = useUnread()
  const navigate = useNavigate()
  const location = useLocation()
  const { id: legacyRouteId, ref: routeRef } = useParams<{ id?: string; ref?: string }>()
  const [searchParams] = useSearchParams()
  const { topicId: lastTopicId, setLastTopicId } = useLastSelection()
  const { state: debug } = useDebug()
  const TOPICS = useTopics()
  const createTopic = useCreateTopic()
  const deleteTopic = useDeleteTopic()
  const isTopicResolved = useIsTopicResolved()
  const isTopicMember = useIsTopicMember()
  const openWorkTopicIds = useOpenWorkTopicIds()
  const actions = usePeekActions()
  const pathForTopic = useTopicPath()
  const { showToast } = useToast()
  const [yourExpanded, setYourExpanded] = useState(true)
  const [otherExpanded, setOtherExpanded] = useState(true)
  /** The Folder panel is dismissible, not part of the layout (PEEK-24). Open to
   *  begin with, since a topic paired with a project is the case it exists for;
   *  the header button closes it and the choice holds while you browse. */
  const [folderPanelOpen, setFolderPanelOpen] = useState(true)
  const showUnreads = debug.unreads.topics
  const [createOpen, setCreateOpen] = useState(false)

  const handleCreateTopic = (data: StartTopicResult) => {
    setCreateOpen(false)
    const topicId = createTopic(data.title, data.invitees)
    navigate(pathForTopic(topicId))
  }

  const selectedHuddleId = searchParams.get('huddle')

  /**
   * Resolving the URL to a topic (PEE-14).
   *
   * What the canonical URL names is a **protocol** identity — the topic's NIP-29
   * channel uuid, which is the `d` of the relay's `kind:39000` — and not Peek's
   * internal id. That is the whole point: `/topics/3` named a Convex `seedKey`
   * that no other app, and no second deployment, could ever resolve.
   *
   * `undefined` while topics are loading and `null` when the link resolves to
   * nothing. Keeping those apart matters: collapsing them shows a dead-link
   * message for the moment before the data arrives, on every cold load.
   */
  const routeIdentifier = routeRef ? identifierFromRef(routeRef) : null
  const hasRoute = Boolean(routeRef || legacyRouteId)
  const routeTopic = useMemo(() => {
    if (!hasRoute) return null
    if (TOPICS === undefined) return undefined
    if (routeIdentifier) return TOPICS.find((t) => t.folderId === routeIdentifier) ?? null
    // No trailing uuid — either a legacy `/topics/<peek-id>` link, or a `/topic/`
    // ref somebody truncated. Both are answered by the Peek id, and a miss here
    // is a dead link rather than a fallback to somebody else's conversation.
    return TOPICS.find((t) => t.id === (legacyRouteId ?? routeRef)) ?? null
  }, [hasRoute, TOPICS, routeIdentifier, legacyRouteId, routeRef])

  // With no topic in the URL, fall back to the last selection and then to the
  // demo topic, exactly as before — the redirect-effect below puts it in the URL.
  const fallbackId = lastTopicId ?? '3'
  const selectedTopic = hasRoute
    ? routeTopic ?? null
    : TOPICS?.find((t) => t.id === fallbackId) ?? null
  const selectedId = selectedTopic?.id ?? (hasRoute ? null : fallbackId)

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
  const folderProject = useFolderProject(selectedTopic?.id ?? null, panelBusy)

  /** A link that named a topic this viewer cannot reach — deleted, or never theirs. */
  const isDeadLink = hasRoute && routeTopic === null

  useEffect(() => {
    if (hasRoute) {
      if (!selectedTopic) return
      setLastTopicId(selectedTopic.id)
      /*
       * Canonicalise. This is what upgrades a legacy `/topics/<peek-id>` link
       * in place the first time somebody opens one, and what refreshes a slug
       * that a rename has left stale — both without a redirect table, because
       * the identity in the URL is what resolved and the rest is decoration.
       */
      const canonical = topicPath(selectedTopic, { huddleId: selectedHuddleId })
      if (`${location.pathname}${location.search}` !== canonical) {
        navigate(canonical, { replace: true })
      }
    } else if (lastTopicId) {
      // /topics with no id — restore last selection in URL.
      const last = TOPICS?.find((t) => t.id === lastTopicId)
      navigate(last ? topicPath(last) : `/topics/${lastTopicId}`, { replace: true })
    }
  }, [
    hasRoute,
    selectedTopic,
    selectedHuddleId,
    lastTopicId,
    TOPICS,
    location.pathname,
    location.search,
    navigate,
    setLastTopicId,
  ])

  const handleSelectTopic = (id: string) => {
    navigate(pathForTopic(id))
  }

  /** Which topic's details are open, if any. */
  const [detailsTopicId, setDetailsTopicId] = useState<string | null>(null)

  /**
   * What the last delete could not reach, if anything.
   *
   * Shown rather than swallowed: deleting a topic removes it here and asks the
   * relay to drop the channel, and the second half can fail on its own — a
   * non-owner cannot delete somebody else's channel at all. Silence would leave
   * somebody believing a conversation is gone while every admitted member can
   * still read it (PEEK-170).
   */
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null)

  const handleDeleteTopic = (topicId: string) => {
    setDeleteNotice(null)
    void deleteTopic(topicId).then((outcome) => setDeleteNotice(outcome?.message ?? null))
    // Deleting what you're looking at → back to the bare list, no stale URL
    // (also drop the remembered selection or the redirect brings it back).
    if (selectedId === topicId) {
      setLastTopicId(null)
      navigate('/topics', { replace: true })
    }
  }

  // Always alphabetical by title; unread-first overlay when the toggle is on.
  const alphaSorted = [...(TOPICS ?? [])].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  )
  const orderedTopics = showUnreads
    ? alphaSorted.sort((a, b) => Number(topicHasUnread(b.id)) - Number(topicHasUnread(a.id)))
    : alphaSorted

  const view = useTopicView({
    folderProject: folderProject.state,
    topicId: selectedTopic?.id ?? null,
    topicTitle: selectedTopic?.title,
    showUnreads,
    onToggleFolderPanel: hasConvex ? () => setFolderPanelOpen((v) => !v) : undefined,
    folderPanelOpen,
    // The page owns the dialog because both ends open the same one — the row's
    // more-menu in the list and the header's inside the topic (PEE-2).
    onOpenDetails: selectedTopic ? () => setDetailsTopicId(selectedTopic.id) : undefined,
    onDeleteTopic: selectedTopic ? () => handleDeleteTopic(selectedTopic.id) : undefined,
  })

  // Loaded and no topics at all → "No conversation selected" makes no sense
  // here; offer to create the first topic instead (issue #3).
  const isEmptyWorkspace = TOPICS !== undefined && TOPICS.length === 0
  const rightPanel = isEmptyWorkspace ? (
    <div className="flex-1 h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <EmptyState
          icon={<IconMessagePlus size={20} stroke={1.5} />}
          message="No topics yet. Start one to gather a conversation around it."
        />
        <Button variant="primary" onClick={() => setCreateOpen(true)}>New topic</Button>
      </div>
    </div>
  ) : TOPICS === undefined ? (
    <div className="flex-1 h-full" />
  ) : isDeadLink ? (
    // A URL that named a topic and did not find one. Said plainly rather than
    // silently falling back to a default conversation, which would leave
    // somebody believing they were looking at what the link pointed to.
    <div className="flex-1 h-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <EmptyState
          icon={<IconLinkOff size={20} stroke={1.5} />}
          message="This link doesn't lead to a topic you can open. It may have been deleted, or you may not be a member of it."
        />
        <Button variant="outlined" onClick={() => navigate('/topics', { replace: true })}>
          Back to topics
        </Button>
      </div>
    </div>
  ) : (
    view.rightPanel
  )

  return (
    <>
    {/*
      A topic that is gone from Peek and not from the relay. Dismissible rather
      than transient: it is the only signal that a conversation somebody meant
      to delete is still readable by other apps, and a toast that fades takes
      that with it.
    */}
    {deleteNotice && (
      <div
        role="status"
        className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-[640px] rounded-md border border-warning-outline bg-bg-elevated px-3 py-2 text-[12px] leading-[1.4] text-warning-default flex items-start gap-3"
      >
        <span>{deleteNotice}</span>
        <button type="button" className="shrink-0 underline" onClick={() => setDeleteNotice(null)}>
          Dismiss
        </button>
      </div>
    )}
    {createOpen && (
      <CreateTopicDialog
        confirmLabel="Create topic"
        onConfirm={handleCreateTopic}
        onCancel={() => setCreateOpen(false)}
      />
    )}
    {detailsTopicId && (
      <TopicDetailsDialog topicKey={detailsTopicId} onClose={() => setDetailsTopicId(null)} />
    )}
    <AppShell
      leftPanel={
        <div className="flex flex-col h-full">
          <ContainerHeader
            title="All topics"
            chevron
            prop2ndAction
            prop2ndActionTooltip="Sort by"
            prop1stAction
            prop1stActionTooltip="New topic"
            onProp1stAction={() => setCreateOpen(true)}
          />
          <div className="flex-1 overflow-y-auto pt-4 pb-3 px-3 flex flex-col gap-0.5">
            {TOPICS === undefined && <SkeletonSidebarList rows={9} />}
            {renderTopicList()}
          </div>
        </div>
      }
      rightPanel={rightPanel}
      threadPanel={
        // The right column is the thread when one is open, and the Folder panel
        // otherwise (PEEK-24). A reply thread is what somebody just asked for;
        // the Folder is context they chose to keep open.
        view.threadPanel ??
        (hasConvex && folderPanelOpen && selectedTopic && view.folderId ? (
          <TopicProjectPanel
            topicKey={selectedTopic.id}
            folderProject={folderProject.state}
            reload={folderProject.reload}
            onBusyChange={setPanelBusy}
            activity={view.activity}
            subFileLabels={view.subFileLabels}
            selectedConversationId={view.openThreadId}
            onOpenThread={view.openThread}
          />
        ) : undefined)
      }
    />
    </>
  )

  /** The sidebar list body. With non-member topics present, splits into
   *  "Your topics" / "Other topics" sections (QA #2.7 ruling); otherwise a
   *  flat list, exactly as before (mock data carries no membership). */
  function renderTopicList(): ReactNode {
    const memberTopics = orderedTopics.filter((t) => isTopicMember(t.id))
    const otherTopics = orderedTopics.filter((t) => !isTopicMember(t.id))
    if (otherTopics.length === 0) return orderedTopics.map(renderTopicRow)
    return (
      <>
        <SectionHeader title="Your topics" chevron isExpanded={yourExpanded} onToggle={() => setYourExpanded((v) => !v)} className="shrink-0" />
        {yourExpanded && memberTopics.map(renderTopicRow)}
        <Divider className="my-2" />
        <SectionHeader title="Other topics" chevron isExpanded={otherExpanded} onToggle={() => setOtherExpanded((v) => !v)} className="shrink-0" />
        {otherExpanded && otherTopics.map(renderTopicRow)}
      </>
    )
  }

  function renderTopicRow(topic: NonNullable<typeof TOPICS>[number]): ReactNode {
              const topicSelected = selectedId === topic.id && !selectedHuddleId
              return (
                <div key={topic.id} className="flex flex-col gap-0.5">
                  <PersonRow
                    name={topic.title}
                    type="topic"
                    topicStatus={isTopicResolved(topic.id) ? 'resolved' : 'unresolved'}
                    isUnread={(showUnreads && topicHasUnread(topic.id)) || (showUnreads && topicIsUrgent(topic.id))}
                    isUrgent={showUnreads && topicIsUrgent(topic.id)}
                    isSelected={topicSelected}
                    onClick={() => handleSelectTopic(topic.id)}
                    onDeleteTopic={() => handleDeleteTopic(topic.id)}
                    onOpenDetails={() => setDetailsTopicId(topic.id)}
                    openWorkAction={openWorkTopicIds.has(topic.id) ? 'remove' : 'add'}
                    onToggleOpenWork={() => {
                      if (openWorkTopicIds.has(topic.id)) {
                        actions.removeTopicFromOpenWork(topic.id)
                      } else {
                        actions.addTopicsToOpenWork([topic.id])
                        showToast({ label: 'Added to Open work', type: 'success' })
                      }
                    }}
                  />
                </div>
              )
  }
}
