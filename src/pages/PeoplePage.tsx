import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ScrollArea } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { ContainerHeader } from '@/components/ContainerHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { Divider } from '@/components/ui/Divider'
import { StarredSection, type StarredItem } from '@/components/ui/StarredSection'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import { useUnread, useCreateTopicFromDm, usePeople, useStarred } from '@/api'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useLastSelection } from '@/lib/lastSelection'
import { useToast } from '@/lib/toast'
import { useTopicPath } from '@/lib/useTopicPath'
import type { StartTopicResult } from '@/components/CreateTopicDialog'

export function PeoplePage() {
  const { dmHasUnread, dmIsUrgent } = useUnread()
  const navigate = useNavigate()
  const pathForTopic = useTopicPath()
  const location = useLocation()
  const { showToast } = useToast()
  const createTopicFromDm = useCreateTopicFromDm()
  const { dmId: lastDmId, setLastDmId } = useLastSelection()
  const { id: routeId } = useParams<{ id: string }>()
  const { entries: starredEntries, isLoading: starredLoading } = useStarred()
  const { state: debug } = useDebug()
  const showUnreads = debug.unreads.people

  // Everyone in the workspace appears in the DM list (ruling 2026-07-08).
  // A DM's id IS the partner's person key (§2.4) — stable for every viewer,
  // so two people always address the same conversation. (The old scheme minted
  // ids from list position, which collided across viewers.) People with no
  // conversation yet simply start empty. undefined = Convex still loading.
  // (Teams are hidden until they're a real feature — user ruling 2026-07-15.)
  const people = usePeople()
  const DMS = useMemo(() => people?.map((p) => ({ id: p.id, name: p.name })), [people])
  const ALL_ITEMS = useMemo(() => DMS ?? [], [DMS])
  const DM_IDS = useMemo(() => new Set((DMS ?? []).map((d) => d.id)), [DMS])

  // URL is the source of truth — derive selection from routeId.
  const selectedId: string | null = routeId ?? lastDmId ?? null

  const handleSelect = (id: string) => {
    navigate(`/people/${id}`)
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

  const starredDmItems: StarredItem[] = starredEntries
    .filter((e) => e.kind === 'dm')
    .map<StarredItem>((e) => {
      const urgent = showUnreads && dmIsUrgent(e.dmId)
      return {
        id: e.dmId,
        name: e.name,
        type: 'DM',
        avatarSrc: e.avatarSrc,
        isUnread: (showUnreads && dmHasUnread(e.dmId)) || urgent,
        isUrgent: urgent,
      }
    })
    .sort((a, b) => Number(b.isUnread) - Number(a.isUnread))

  const starredDmIds = new Set(starredDmItems.map((s) => s.id))
  // Sort: unread first when toggle on, otherwise input order. Then drop starred DMs.
  const sortedDms = showUnreads
    ? [...(DMS ?? [])].sort((a, b) => Number(dmHasUnread(b.id)) - Number(dmHasUnread(a.id)))
    : DMS ?? []
  const visibleDms = sortedDms.filter((dm) => !starredDmIds.has(dm.id))

  useEffect(() => {
    if (routeId && DM_IDS.has(routeId)) {
      setLastDmId(routeId)
    } else if (!routeId && lastDmId != null) {
      // Returning to /people with no id — restore last selection in URL.
      navigate(`/people/${lastDmId}`, { replace: true })
    }
  }, [routeId, lastDmId, navigate, setLastDmId, DM_IDS])

  const selectedItem = selectedId ? ALL_ITEMS.find((i) => i.id === selectedId) : null
  const isDm = selectedId != null && DM_IDS.has(selectedId)

  const dmView = useDmConversationView({
    dmId: isDm ? selectedId : null,
    dmName: isDm ? selectedItem?.name : undefined,
    showUnreads,
    onStartTopicFromDm: handleStartTopicFromDm,
  })

  return (
    <AppShell
      leftPanel={
        <div className="flex flex-col h-full">
          <ContainerHeader
            title="People"
            prop1stAction
            prop1stActionTooltip="New conversation"
            prop2ndAction
            prop2ndActionTooltip="Sort by"
          />
          <ScrollArea className="flex-1" contentClassName="pt-4 pb-3 px-3 flex flex-col gap-1">
            {DMS === undefined || starredLoading ? (
              <SkeletonSidebarList rows={8} />
            ) : (
              <>
                <StarredSection
                  items={starredDmItems}
                  selectedId={selectedId}
                  onSelect={handleSelect}
                />

                {/* Divider only when there are people below it — no dangling
                    line when the workspace has no one else yet (issue #2). */}
                {visibleDms.length > 0 && <Divider className="my-2" />}

                {visibleDms.map((dm) => {
                  const urgent = showUnreads && dmIsUrgent(dm.id)
                  return (
                    <PersonRow
                      key={dm.id}
                      name={dm.name}
                      type="DM"
                      isUnread={(showUnreads && dmHasUnread(dm.id)) || urgent}
                      isUrgent={urgent}
                      isSelected={selectedId === dm.id}
                      onClick={() => handleSelect(dm.id)}
                    />
                  )
                })}
              </>
            )}
          </ScrollArea>
        </div>
      }
      rightPanel={DMS === undefined ? <div className="flex-1 h-full" /> : dmView.rightPanel}
      threadPanel={dmView.threadPanel}
    />
  )
}
