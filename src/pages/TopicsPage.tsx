import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { IconMessagePlus, IconLinkOff, IconEdit, IconSortDescending } from '@tabler/icons-react'
import { AppShell } from '@/layouts/AppShell'
import { TopicDetailsDialog } from '@/components/TopicDetailsDialog'
import { CreateTopicDialog, type StartTopicResult } from '@/components/CreateTopicDialog'
import { ConfirmDelete } from '@/components/ConfirmDelete'
import { PersonRow } from '@/components/ui/PersonRow'
import { Divider } from '@/components/ui/Divider'
import { CollapsibleSection, ListColumn, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { useRailClosed } from '@/layouts/railClosed'
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
import { rememberRecent } from '@/lib/recents'

/**
 * The Topics page: all topics on the left, split into yours and others, and the
 * chosen topic beside them with its replies or Files panel.
 */
export function TopicsPage() {
  const railClosed = useRailClosed()
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
      // The launcher's Recent group (UIG-29, C3).
      rememberRecent({ kind: 'topic', id: selectedTopic.id })
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
   * Delete asks first (D56): the menu row opens the question, the delete runs
   * on Yes.
   *
   * What the delete could not reach is shown rather than swallowed: deleting a
   * topic removes it here and asks the relay to drop the channel, and the
   * second half can fail on its own — a non-owner cannot delete somebody else's
   * channel at all. Silence would leave somebody believing a conversation is
   * gone while every admitted member can still read it (PEEK-170). Since
   * 2026-09-10 that is the package toast, kept up until dismissed (D50, P24)
   * — it was a hand-built pill at the top of the page.
   */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const handleDeleteTopic = (topicId: string) => setConfirmDeleteId(topicId)

  const runDeleteTopic = (topicId: string) => {
    void deleteTopic(topicId).then((outcome) => {
      if (outcome?.message) {
        showToast({ label: outcome.message, type: 'warning', leadingIcon: false, durationMs: 0, actionLabel: 'Dismiss' })
      }
    })
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
    <EmptyState
      icon={<IconMessagePlus size={16} stroke={1.5} />}
      message="No topics yet."
      action={{ label: 'New topic', onClick: () => setCreateOpen(true) }}
    />
  ) : TOPICS === undefined ? (
    <div className="flex-1 h-full" />
  ) : isDeadLink ? (
    // A URL that named a topic and did not find one. Said plainly rather than
    // silently falling back to a default conversation, which would leave
    // somebody believing they were looking at what the link pointed to.
    <EmptyState
      icon={<IconLinkOff size={16} stroke={1.5} />}
      message="This link doesn't lead to a topic you can open. It may have been deleted, or you may not be a member."
      action={{ label: 'Back to topics', onClick: () => navigate('/topics', { replace: true }) }}
    />
  ) : (
    view.rightPanel
  )

  return (
    <>
      {confirmDeleteId && (
        <ConfirmDelete
          what="topic"
          onConfirm={() => runDeleteTopic(confirmDeleteId)}
          onClose={() => setConfirmDeleteId(null)}
        />
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
      <TopicsPageView
        railClosed={railClosed}
        loading={TOPICS === undefined}
        topics={orderedTopics.map((topic) => ({
          id: topic.id,
          title: topic.title,
          isResolved: isTopicResolved(topic.id),
          isUnread: showUnreads && (topicHasUnread(topic.id) || topicIsUrgent(topic.id)),
          isUrgent: showUnreads && topicIsUrgent(topic.id),
          isMember: isTopicMember(topic.id),
          inOpenWork: openWorkTopicIds.has(topic.id),
        }))}
        selectedId={selectedHuddleId ? null : selectedId}
        onSelect={handleSelectTopic}
        onNewTopic={() => setCreateOpen(true)}
        onDeleteTopic={handleDeleteTopic}
        onOpenDetails={setDetailsTopicId}
        onToggleOpenWork={(id, inOpenWork) => {
          if (inOpenWork) {
            actions.removeTopicFromOpenWork(id)
          } else {
            actions.addTopicsToOpenWork([id])
            showToast({ label: 'Added to Open work', type: 'success' })
          }
        }}
        rightPanel={rightPanel}
        threadPanel={
          // The right column is the thread when one is open, and the Folder
          // panel otherwise (PEEK-24). A reply thread is what somebody just
          // asked for; the Folder is context they chose to keep open.
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
}

/** One row in the topic list, with everything it needs already decided. */
export interface TopicListItem {
  id: string
  title: string
  isResolved: boolean
  isUnread: boolean
  isUrgent: boolean
  /** Decides which section it falls in — see the view's note on that split. */
  isMember: boolean
  inOpenWork: boolean
}

/**
 * The Topics page's body, handed everything it draws — the half a story can
 * show (UIG-17). `TopicsPage` above reads, routes and owns the dialogs; this
 * one only draws.
 *
 * The topic list is here rather than the Folder tree (Miky, 2026-09-14).
 * peek#213 put the tree in this column, and until FOL-22 turns the twenty-five
 * topics into rows a topic *is* a Folder in it — a section, opened from a hover
 * action, with no highlighted row. That is not a column to read topics from.
 * The tree is where a Folder is navigated: the Folders rail item and the file
 * page.
 */
export function TopicsPageView({
  railClosed,
  loading,
  topics,
  selectedId,
  onSelect,
  onNewTopic,
  onDeleteTopic,
  onOpenDetails,
  onToggleOpenWork,
  rightPanel,
  threadPanel,
}: {
  railClosed: boolean
  /** The first read, still in flight. Not the same as a workspace with none. */
  loading: boolean
  /** Already ordered. The view only decides how to section them. */
  topics: TopicListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNewTopic: () => void
  onDeleteTopic: (id: string) => void
  onOpenDetails: (id: string) => void
  /** The second argument is whether it is in Open work now. */
  onToggleOpenWork: (id: string, inOpenWork: boolean) => void
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}) {
  const row = (topic: TopicListItem): ReactNode => (
    <div key={topic.id} className="flex flex-col gap-0.5">
      <PersonRow
        name={topic.title}
        type="topic"
        topicStatus={topic.isResolved ? 'resolved' : 'unresolved'}
        isUnread={topic.isUnread}
        isUrgent={topic.isUrgent}
        isSelected={selectedId === topic.id}
        onClick={() => onSelect(topic.id)}
        onDeleteTopic={() => onDeleteTopic(topic.id)}
        onOpenDetails={() => onOpenDetails(topic.id)}
        openWorkAction={topic.inOpenWork ? 'remove' : 'add'}
        onToggleOpenWork={() => onToggleOpenWork(topic.id, topic.inOpenWork)}
      />
    </div>
  )

  /*
    With non-member topics present the list splits into "Your topics" and
    "Other topics" (QA #2.7); otherwise it is flat, exactly as before. The
    package's CollapsibleSection owns its rows, the slide and the memory of the
    fold (§4.8, D42), so nothing here keeps an expanded flag.
  */
  const mine = topics.filter((t) => t.isMember)
  const others = topics.filter((t) => !t.isMember)
  const list =
    others.length === 0 ? (
      topics.map(row)
    ) : (
      <>
        <CollapsibleSection title="Your topics" storageKey="peek.topics.yours" className="shrink-0" contentClassName="gap-0.5">
          {mine.map(row)}
        </CollapsibleSection>
        <Divider className="my-2" />
        <CollapsibleSection title="Other topics" storageKey="peek.topics.others" className="shrink-0" contentClassName="gap-0.5">
          {others.map(row)}
        </CollapsibleSection>
      </>
    )

  return (
    <AppShell
      leftPanel={
        <ListColumn
          title="All topics"
          chevron
          collapsed={railClosed}
          actions={
            // One strip: one Tab stop, arrows along it (UIG-14).
            <Toolbar aria-label="Topic list actions" surface={false}>
              <ToolbarButton tooltip="Sort by" aria-label="Sort by">
                <IconSortDescending size={16} stroke={1.5} />
              </ToolbarButton>
              <ToolbarButton tooltip="New topic" aria-label="New topic" onClick={onNewTopic}>
                <IconEdit size={16} stroke={1.5} />
              </ToolbarButton>
            </Toolbar>
          }
        >
          {loading && <SkeletonSidebarList rows={9} />}
          {list}
        </ListColumn>
      }
      rightPanel={rightPanel}
      threadPanel={threadPanel}
    />
  )
}
