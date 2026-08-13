import { useEffect, useState, type ReactNode } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { IconMessagePlus } from '@tabler/icons-react'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { CreateTopicDialog, type StartTopicResult } from '@/components/CreateTopicDialog'
import { PersonRow } from '@/components/ui/PersonRow'
import { Divider } from '@/components/ui/Divider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTopicView } from '@/components/views/useTopicView'
import { TopicProjectPanel } from '@/components/TopicProjectPanel'
import { CURRENT_USER_NAME, hasConvex, useUnread, useTopics, useCreateTopic, useDeleteTopic, useIsTopicResolved, useIsTopicMember, useHuddleLookup } from '@/api'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useLastSelection } from '@/lib/lastSelection'

export function TopicsPage() {
  const { topicHasUnread, topicIsUrgent } = useUnread()
  const navigate = useNavigate()
  const { id: routeId } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const { topicId: lastTopicId, setLastTopicId } = useLastSelection()
  const { state: debug } = useDebug()
  const TOPICS = useTopics()
  const createTopic = useCreateTopic()
  const deleteTopic = useDeleteTopic()
  const isTopicResolved = useIsTopicResolved()
  const isTopicMember = useIsTopicMember()
  const [yourExpanded, setYourExpanded] = useState(true)
  const [otherExpanded, setOtherExpanded] = useState(true)
  const huddleLookup = useHuddleLookup()
  /** The Folder panel is dismissible, not part of the layout (PEEK-24). Open to
   *  begin with, since a topic paired with a project is the case it exists for;
   *  the header button closes it and the choice holds while you browse. */
  const [folderPanelOpen, setFolderPanelOpen] = useState(true)
  const showUnreads = debug.unreads.topics
  const huddleVariant = debug.huddles.variant
  const [createOpen, setCreateOpen] = useState(false)

  const handleCreateTopic = (data: StartTopicResult) => {
    setCreateOpen(false)
    const topicId = createTopic(data.title, data.invitees)
    navigate(`/topics/${topicId}`)
  }

  // URL is the source of truth. Fallbacks only kick in until the redirect-effect lands.
  const selectedId = routeId ?? lastTopicId ?? '3'
  const selectedHuddleId = searchParams.get('huddle')

  useEffect(() => {
    if (routeId) {
      setLastTopicId(routeId)
    } else if (lastTopicId) {
      // /topics with no id — restore last selection in URL.
      navigate(`/topics/${lastTopicId}`, { replace: true })
    }
  }, [routeId, lastTopicId, navigate, setLastTopicId])

  const handleSelectTopic = (id: string) => {
    navigate(`/topics/${id}`)
  }

  const handleSelectHuddle = (topicId: string, huddleId: string) => {
    navigate(`/topics/${topicId}?huddle=${huddleId}`)
  }

  const handleDeleteTopic = (topicId: string) => {
    deleteTopic(topicId)
    // Deleting what you're looking at → back to the bare list, no stale URL
    // (also drop the remembered selection or the redirect brings it back).
    if (selectedId === topicId) {
      setLastTopicId(null)
      navigate('/topics', { replace: true })
    }
  }

  const selectedTopic = TOPICS?.find((t) => t.id === selectedId) ?? null

  /** Huddles you're a member of, for a given topic. Used to render the V2 sidebar tree. */
  const huddlesForSidebar = (topicId: string) =>
    huddleLookup(topicId).filter((h) => h.members.includes(CURRENT_USER_NAME))

  // Always alphabetical by title; unread-first overlay when the toggle is on.
  const alphaSorted = [...(TOPICS ?? [])].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  )
  const orderedTopics = showUnreads
    ? alphaSorted.sort((a, b) => Number(topicHasUnread(b.id)) - Number(topicHasUnread(a.id)))
    : alphaSorted

  const view = useTopicView({
    topicId: selectedTopic?.id ?? null,
    topicTitle: selectedTopic?.title,
    selectedHuddleId,
    showUnreads,
    onToggleFolderPanel: hasConvex ? () => setFolderPanelOpen((v) => !v) : undefined,
    folderPanelOpen,
  })
  console.log(`[TRACE] TopicsPage: selectedTopic.id=${selectedTopic?.id}, view.folderId=${view.folderId}, folderPanelOpen=${folderPanelOpen}`)

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
  ) : (
    view.rightPanel
  )

  return (
    <>
    {createOpen && (
      <CreateTopicDialog
        confirmLabel="Create topic"
        onConfirm={handleCreateTopic}
        onCancel={() => setCreateOpen(false)}
      />
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
          (() => {
            console.log(`[TRACE] TopicsPage: rendering TopicProjectPanel with topicKey=${selectedTopic.id}`)
            return <TopicProjectPanel topicKey={selectedTopic.id} />
          })()
        ) : (() => {
          console.log(`[TRACE] TopicsPage: NOT rendering TopicProjectPanel. hasConvex=${hasConvex}, folderPanelOpen=${folderPanelOpen}, selectedTopic=${!!selectedTopic}, view.folderId=${view.folderId}`)
          return undefined
        })())
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
              const topicHuddles = huddleVariant === 2 ? huddlesForSidebar(topic.id) : []
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
                  />
                  {topicHuddles.length > 0 && (() => {
                    // Linear-style branch tree, drawn as a single SVG path:
                    //   - one vertical line from the top of the first child down to just
                    //     above the last child's center
                    //   - a quadratic curve forming the rounded ⌐ corner at the last child
                    //   - a horizontal segment from the curve to the row content
                    //   - per non-last child, a horizontal stub at its center (the vertical
                    //     already runs through this y, so they connect with no overlap)
                    //
                    // Drawing it all as one path guarantees: continuous (no pixel gaps at
                    // segment joins), uniform stroke (no double-paint brightness), exact
                    // rounded corner. PersonRow is h-[32px]; radius matches rounded-md.
                    const ROW_H = 32
                    const RADIUS = 6
                    const STUB_X = 12
                    const lastCenter = (topicHuddles.length - 1) * ROW_H + ROW_H / 2
                    // Each non-last row's branch is a rounded ⌐ curve (same radius as the
                    // bottom └), starting from the vertical at y-RADIUS and curving out to
                    // the horizontal stub. The main vertical line continues straight through
                    // y-RADIUS and y, so visually the branch tangents off the vertical.
                    const stubs = topicHuddles
                      .slice(0, -1)
                      .map((_, i) => {
                        const y = i * ROW_H + ROW_H / 2
                        return `M 0.5 ${y - RADIUS} Q 0.5 ${y}, ${RADIUS + 0.5} ${y} L ${STUB_X} ${y}`
                      })
                      .join(' ')
                    const d = [
                      `M 0.5 0`,
                      `L 0.5 ${lastCenter - RADIUS}`,
                      `Q 0.5 ${lastCenter}, ${RADIUS + 0.5} ${lastCenter}`,
                      `L ${STUB_X} ${lastCenter}`,
                      stubs,
                    ]
                      .filter(Boolean)
                      .join(' ')

                    return (
                      <div className="ml-4 flex flex-col relative">
                        <svg
                          className="pointer-events-none absolute left-0 top-0"
                          width={STUB_X}
                          height={topicHuddles.length * ROW_H}
                          viewBox={`0 0 ${STUB_X} ${topicHuddles.length * ROW_H}`}
                        >
                          <path
                            d={d}
                            style={{ stroke: 'var(--border-strong)' }}
                            strokeWidth="1"
                            strokeLinecap="round"
                            fill="none"
                          />
                        </svg>
                        {topicHuddles.map((h) => {
                          // Show comma-joined member names, excluding "You" (matches group-DM convention)
                          const others = h.members.filter((n) => n !== CURRENT_USER_NAME)
                          const label = others.length > 0 ? others.join(', ') : h.members.join(', ')
                          return (
                            <div key={h.id} className="relative pl-3">
                              <PersonRow
                                name={label}
                                type="huddle"
                                isSelected={selectedId === topic.id && selectedHuddleId === h.id}
                                onClick={() => handleSelectHuddle(topic.id, h.id)}
                              />
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )
  }
}
