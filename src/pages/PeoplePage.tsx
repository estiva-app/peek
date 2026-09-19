import { IconEdit, IconSortDescending } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ContainerHeader, ScrollArea, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { PersonRow } from '@/components/ui/PersonRow'
import { Divider } from '@/components/ui/Divider'
import { StarredSection, type StarredItem } from '@/components/ui/StarredSection'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import { useUnread, useCreateTopicFromDm, usePeople, useStarred, useDmVisibility } from '@/api'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useLastSelection } from '@/lib/lastSelection'
import { useToast } from '@/lib/toast'
import { useTopicPath } from '@/lib/useTopicPath'
import { rememberRecent } from '@/lib/recents'
import type { StartTopicResult } from '@/components/CreateTopicDialog'

/**
 * The People page: starred people and everyone in the workspace on the left,
 * and the direct message with the chosen person beside them.
 */
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
  const { isDmHidden, canHideDm, hideDm: hideDmRemote } = useDmVisibility()
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
  // Sort: unread first when toggle on, otherwise input order. Then drop starred
  // DMs, and the ones the viewer has hidden (DMS-6). Hidden is the relay's
  // per-viewer set, so it never touches the Starred section: a star is an
  // explicit ask to keep something in front of you, and the two lists are
  // curated separately. A hidden DM comes back by being opened — from the
  // launcher, the Desk or a star — so nothing here is a way to lose one.
  const sortedDms = showUnreads
    ? [...(DMS ?? [])].sort((a, b) => Number(dmHasUnread(b.id)) - Number(dmHasUnread(a.id)))
    : DMS ?? []
  const visibleDms = sortedDms.filter((dm) => !starredDmIds.has(dm.id) && !isDmHidden(dm.id))

  const hideDm = (dmId: string) => {
    void hideDmRemote(dmId)
    // Hiding what you're looking at → back to the bare list, no stale URL
    // (also drop the remembered selection or the redirect brings it back —
    // and reopening it would undo the hide).
    if (selectedId === dmId) {
      setLastDmId(null)
      navigate('/people', { replace: true })
    }
  }

  useEffect(() => {
    if (routeId && DM_IDS.has(routeId)) {
      setLastDmId(routeId)
      // The launcher's Recent group (UIG-29, C3).
      rememberRecent({ kind: 'person', id: routeId })
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
    onHideDm: isDm && canHideDm(selectedId) ? () => hideDm(selectedId) : undefined,
  })

  return (
    <AppShell
      leftPanel={
        <div className="flex flex-col h-full">
          <ContainerHeader
            title="People"
            actions={
              // One strip: one Tab stop, arrows along it (UIG-14).
              <Toolbar aria-label="People actions" surface={false}>
                <ToolbarButton tooltip="Sort by" aria-label="Sort by">
                  <IconSortDescending size={16} stroke={1.5} />
                </ToolbarButton>
                <ToolbarButton tooltip="New conversation" aria-label="New conversation">
                  <IconEdit size={16} stroke={1.5} />
                </ToolbarButton>
              </Toolbar>
            }
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
                      onHideDm={canHideDm(dm.id) ? () => hideDm(dm.id) : undefined}
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
