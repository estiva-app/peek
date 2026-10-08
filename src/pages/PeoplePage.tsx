import { IconEdit, IconSortDescending } from '@tabler/icons-react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ListColumn, Toolbar, ToolbarButton } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { useRailClosed } from '@/layouts/railClosed'
import { PersonRow } from '@/components/ui/PersonRow'
import { Divider } from '@/components/ui/Divider'
import { StarredSection, type StarredItem } from '@/components/ui/StarredSection'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import {
  hasRelay,
  isPersonKey,
  useDmChannels,
  useDmVisibility,
  useStarred,
  useUnread,
  useWorkspacePeople,
} from '@/api'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'
import { useLastSelection } from '@/lib/lastSelection'
import { rememberRecent } from '@/lib/recents'

/**
 * The People page: starred people and everyone in the workspace on the left,
 * and the direct message with the chosen person beside them.
 */
export function PeoplePage() {
  const railClosed = useRailClosed()
  const { dmHasUnread, dmIsUrgent } = useUnread()
  const navigate = useNavigate()
  const { dmId: lastDmId, setLastDmId } = useLastSelection()
  const { id: routeId } = useParams<{ id: string }>()
  const { entries: starredEntries, isLoading: starredLoading } = useStarred()
  const { isDmHidden, canHideDm, hideDm: hideDmRemote } = useDmVisibility()
  const { partners } = useDmChannels()
  const { state: debug } = useDebug()
  const showUnreads = debug.unreads.people

  // Everyone in the workspace appears in the DM list (ruling 2026-07-08), read
  // from the relay: the roster, named by profiles, humans only (REM-3). A DM's
  // id IS the partner's pubkey (§2.4) — the same for every viewer and every
  // app, so two people always address the same conversation. People with no
  // conversation yet simply start empty; anyone the viewer already has a DM
  // with stays listed after leaving the roster. undefined = still loading.
  // (Teams are hidden until they're a real feature — user ruling 2026-07-15.)
  const people = useWorkspacePeople(partners)
  const DMS = useMemo(() => people?.map((p) => ({ id: p.id, name: p.name, avatarSrc: p.avatarSrc })), [people])
  const ALL_ITEMS = useMemo(() => DMS ?? [], [DMS])
  const DM_IDS = useMemo(() => new Set((DMS ?? []).map((d) => d.id)), [DMS])

  // URL is the source of truth — derive selection from routeId.
  const selectedId: string | null = routeId ?? lastDmId ?? null

  const handleSelect = (id: string) => {
    navigate(`/app/people/${id}`)
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
      navigate('/app/people', { replace: true })
    }
  }

  useEffect(() => {
    /*
      A link from before REM-3 names a Convex id or `seedKey`. Nothing but
      Convex can say whose, so it lands on the list rather than on somebody's
      conversation by guess; stars and open work carried the pubkey and were
      moved, and every link Peek draws now is a pubkey.
    */
    if (routeId && hasRelay && !isPersonKey(routeId)) {
      if (lastDmId === routeId) setLastDmId(null)
      navigate('/app/people', { replace: true })
      return
    }
    if (routeId && DM_IDS.has(routeId)) {
      setLastDmId(routeId)
      // The launcher's Recent group (UIG-29, C3).
      rememberRecent({ kind: 'person', id: routeId })
    } else if (!routeId && lastDmId != null) {
      // Returning to /app/people with no id — restore last selection in URL.
      navigate(`/app/people/${lastDmId}`, { replace: true })
    }
  }, [routeId, lastDmId, navigate, setLastDmId, DM_IDS])

  const selectedItem = selectedId ? ALL_ITEMS.find((i) => i.id === selectedId) : null
  const isDm = selectedId != null && DM_IDS.has(selectedId)

  const dmView = useDmConversationView({
    dmId: isDm ? selectedId : null,
    dmName: isDm ? selectedItem?.name : undefined,
    showUnreads,
    onHideDm: isDm && canHideDm(selectedId) ? () => hideDm(selectedId) : undefined,
  })

  return (
    <PeoplePageView
      railClosed={railClosed}
      loading={DMS === undefined || starredLoading}
      starred={starredDmItems}
      people={visibleDms.map((dm) => {
        const urgent = showUnreads && dmIsUrgent(dm.id)
        return {
          id: dm.id,
          name: dm.name,
          avatarSrc: dm.avatarSrc,
          isUnread: (showUnreads && dmHasUnread(dm.id)) || urgent,
          isUrgent: urgent,
          canHide: canHideDm(dm.id),
        }
      })}
      selectedId={selectedId}
      onSelect={handleSelect}
      onHideDm={hideDm}
      rightPanel={DMS === undefined ? <div className="flex-1 h-full" /> : dmView.rightPanel}
      threadPanel={dmView.threadPanel}
    />
  )
}

/** One row in the people list, with everything it needs already decided. */
export interface PeopleListItem {
  id: string
  name: string
  /** The profile's picture; absent falls back to the name-keyed registry. */
  avatarSrc?: string
  isUnread: boolean
  isUrgent: boolean
  /** Hiding is offered only where it can succeed (DMS-6). */
  canHide: boolean
}

/**
 * The People page's body, handed everything it draws — the half a story can
 * show (UIG-17).
 *
 * `PeoplePage` above reads, sorts and routes; this one only draws, so a story
 * can put it in the shell with a fixture and show an empty workspace, a long
 * list or a first read still in flight — none of which the live page could
 * ever be made to show.
 */
export function PeoplePageView({
  railClosed,
  loading,
  starred,
  people,
  selectedId,
  onSelect,
  onHideDm,
  rightPanel,
  threadPanel,
}: {
  railClosed: boolean
  /** The first read, still in flight. Not the same as an empty workspace. */
  loading: boolean
  starred: StarredItem[]
  /** Already sorted, already filtered of starred and hidden. */
  people: PeopleListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onHideDm: (id: string) => void
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}) {
  return (
    <PeekFrame
      leftPanel={
        <ListColumn
          title="People"
          collapsed={railClosed}
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
        >
          {loading ? (
            <SkeletonSidebarList rows={8} />
          ) : (
            <>
              <StarredSection items={starred} selectedId={selectedId} onSelect={onSelect} />

              {/* Divider only when there are people below it — no dangling
                  line when the workspace has no one else yet (issue #2). */}
              {people.length > 0 && <Divider className="my-2" />}

              {people.map((dm) => (
                <PersonRow
                  key={dm.id}
                  name={dm.name}
                  avatarSrc={dm.avatarSrc}
                  type="DM"
                  isUnread={dm.isUnread}
                  isUrgent={dm.isUrgent}
                  isSelected={selectedId === dm.id}
                  onClick={() => onSelect(dm.id)}
                  onHideDm={dm.canHide ? () => onHideDm(dm.id) : undefined}
                />
              ))}
            </>
          )}
        </ListColumn>
      }
      rightPanel={rightPanel}
      threadPanel={threadPanel}
    />
  )
}
