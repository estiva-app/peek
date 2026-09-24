import { useCallback, useState, type ComponentProps, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { IconArrowUpRight, IconSortDescending } from '@tabler/icons-react'
import { CollapsibleSection, ContainerHeader, ListColumn, Toolbar, ToolbarLink } from '@estiva-app/ui'
import { AppShell } from '@/layouts/AppShell'
import { useRailClosed } from '@/layouts/railClosed'
import { Divider } from '@/components/ui/Divider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { PersonRow } from '@/components/ui/PersonRow'
import { ScreenerSection } from '@/components/ScreenerSection'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import { useFileView } from '@/components/views/useFileView'
import {
  dmNameById,
  useUnread,
  hasConvex,
  useScreenerItems,
  useDeskItems,
  useDeskLoading,
  usePeekActions,
  useStarred,
  useLiveConversationBadges,
  useOpenWorkFiles,
} from '@/api'
import { KIND_BARE_FILE } from '@estiva-app/interop'
import { filePath } from '@/lib/objectUrl'
import { followInApp } from '@/lib/followInApp'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'

type SectionKey = 'urgent' | 'openWork' | 'starred'

type Selected = { dmId: string; dmName: string; section: SectionKey }

/**
 * The Desk page: the Screener, Urgent, Open work and Starred lists on the left,
 * and the chosen file or direct message beside them.
 *
 * A DM or a file. A Convex topic was the third kind until FOL-23: its rows and
 * the "+" picker that offered only topics went with the Convex topics. A topic
 * still in somebody's open work or stars stays in their blob and draws nothing
 * (`internal/openWork.tsx`, `internal/starred.tsx`).
 */
export function DeskPage() {
  const railClosed = useRailClosed()
  const { dmHasUnread } = useUnread()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { state: debug } = useDebug()
  const { entries: starredAll, isDmStarred, toggleDm, isLoading: starredLoading } = useStarred()
  const deskLoading = useDeskLoading()
  const actions = usePeekActions()
  const allScreenerItems = useScreenerItems()
  const { openWork: OPEN_WORK_ITEMS, urgent: URGENT_ITEMS } = useDeskItems()
  const [selected, setSelected] = useState<Selected | null>(null)
  /*
    The file open beside the lists (SID-3), in the URL rather than in state, so
    a reload or a pasted Desk link keeps it open — and its thread with it, as
    on the file's own page. A DM stays in state, as it always has.
  */
  const openAddress = searchParams.get('open')
  const openThreadId = searchParams.get('thread') ?? undefined
  /** Which section the open file was clicked in, and the title its row showed. Lost on a reload. */
  const [openedFrom, setOpenedFrom] = useState<{ section: SectionKey; title: string } | null>(null)
  const [dismissedScreenerIds, setDismissedScreenerIds] = useState<Set<string>>(new Set())
  const [dismissedOpenWorkIds, setDismissedOpenWorkIds] = useState<Set<string>>(new Set())

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

  // Section-level unread visibility (per-page debug toggles). A file's dot
  // follows the topics toggle, as it did when the two shared Open work.
  const showFileUnreads = debug.unreads.topics
  const showPeopleUnreads = debug.unreads.people

  /*
    A file's dot (FOL-34) is the listing's: its own conversation against its own
    marker, and only for what the person follows. `=== true` — an unjudged file
    draws no dot, not a dark one. Live: it re-reads when something is said in
    one of the files' Folders, not only when the list changes.
  */
  const openWorkFiles = useOpenWorkFiles()
  const { unread: fileUnread } = useLiveConversationBadges(
    OPEN_WORK_ITEMS.flatMap((i) => (i.kind === 'file' ? [i.object] : [])),
  )

  // Open work holds files and (via Screener "Open") DMs, in the person's order
  // — new work on the end, like a browser tab (Miky, 2026-09-16). Not sorted
  // by unread: that moved a row the moment it was read, so opening something
  // from the Screener put it first and reading it sent it last. The dot says
  // what is unread. Filter out items dismissed via the row's X.
  const openWorkItems = (debug.desk.openWorkHasData ? OPEN_WORK_ITEMS : [])
    .filter((i) => !dismissedOpenWorkIds.has(i.id))

  const dismissOpenWork = (id: string) => {
    // Removing the conversation you're looking at clears the stale selection —
    // the right panel falls back to "No conversation selected" (QA #2.2).
    const item = openWorkItems.find((i) => i.id === id)
    if (item?.kind === 'dm') {
      if (selected?.dmId === item.dmId) setSelected(null)
    } else if (item && item.address === openAddress) {
      closeFile()
    }
    setDismissedOpenWorkIds((prev) => new Set([...prev, id]))
    // Every kind removes by the key the blob holds, never by a row id: since
    // SHR-9 the list comes from the relay and the rows carry synthetic ids.
    if (item?.kind === 'file') openWorkFiles.remove(item.address)
    else if (item?.kind === 'dm') actions.removeDmFromOpenWork(item.dmId)
  }

  // Starred holds DMs. Unread first when the toggle is on.
  const baseStarred = debug.desk.starredHasData ? starredAll : []
  const starredEntries = showPeopleUnreads
    ? [...baseStarred].sort((a, b) => Number(dmHasUnread(b.dmId)) - Number(dmHasUnread(a.dmId)))
    : baseStarred

  // Selection dedup: the section that owns the selected highlight is wherever
  // the user last clicked. So clicking the same item from a different section
  // moves the highlight to that section.
  const selectionAnchor: SectionKey | null = selected?.section ?? null
  const isSelectedIn = (section: SectionKey, dmId: string) =>
    selectionAnchor === section && selected?.dmId === dmId

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
      item.kind === 'file' ? { kind: 'file', address: item.address } : { kind: 'dm', dmId: item.dmId },
    )
  }

  /** "Later" hides the item now; it reappears after the chosen reminder time. */
  const laterScreener = (id: string, untilMs: number) => {
    setDismissedScreenerIds((prev) => new Set([...prev, id]))
    actions.snoozeScreenerItem(id, untilMs)
  }

  /*
    A file opens beside the lists, and the rail stays on Desk (SID-3): the
    file's own relay conversation, the one `FilePage` draws (`useFileView`).
  */
  const openFile = (address: string, title: string, section: SectionKey) => {
    setSelected(null)
    setOpenedFrom({ section, title })
    setSearchParams({ open: address })
  }
  const closeFile = () => {
    setOpenedFrom(null)
    setSearchParams({}, { replace: true })
  }
  const selectDm = (dmId: string, fallbackName: string, section: SectionKey) => {
    const dmName = dmNameById(dmId) ?? fallbackName
    if (openAddress) closeFile()
    setSelected({ dmId, dmName, section })
  }
  const setOpenThread = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (id) next.set('thread', id)
      else next.delete('thread')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )
  /**
   * Whether a row is the open file. After a reload the section it was clicked
   * in is not known, so every row naming it is lit — the one case where the
   * Selection dedup above cannot say which section owns it.
   */
  const isOpen = (address: string, section: SectionKey) =>
    address === openAddress && (openedFrom == null || openedFrom.section === section)

  // On Desk, unstarring a DM clears selection unless it is still reachable via
  // Urgent. If the selection was anchored to Starred, migrate it there.
  // Starring is harmless.
  const handleToggleStarredOnDesk = () => {
    if (!selected) return
    const wasStarred = isDmStarred(selected.dmId)
    toggleDm({ dmId: selected.dmId, name: selected.dmName })
    if (!wasStarred) return
    const inUrgent = urgentItems.some((u) => u.dmId === selected.dmId)
    if (!inUrgent) setSelected(null)
    else if (selected.section === 'starred') setSelected({ ...selected, section: 'urgent' })
  }

  // Both hooks always run - each only does meaningful work when its id is set
  const dmView = useDmConversationView({
    dmId: selected?.dmId ?? null,
    dmName: selected?.dmName,
    onToggleStarred: selected ? handleToggleStarredOnDesk : undefined,
    showUnreads: showPeopleUnreads,
  })
  /*
    The open file, as its own page draws it: the conversation, a composer, the
    thread or the owner's widget in the third column, and the read marker. The
    header is the Desk's — the file's title and a way to its full page, which
    is where the tree, the trail and the file's menu are.
  */
  const fileView = useFileView({
    address: selected ? null : openAddress,
    openThreadId,
    onOpenThread: setOpenThread,
  })
  const fileTitle = fileView.file?.slots.title?.value ?? openedFrom?.title ?? 'File'
  const fullPage = openAddress ? filePath(openAddress, fileView.file?.slots.title?.value ?? openedFrom?.title) : null
  const filePane = fullPage ? (
    <div className="flex h-full flex-col">
      <ContainerHeader
        title={
          <div className="min-w-0">
            <p className="truncate text-body-2-strong text-text-primary">{fileTitle}</p>
            {fileView.file?.appName && (
              <p className="truncate text-caption text-text-muted">In {fileView.file.appName}</p>
            )}
          </div>
        }
        actions={
          <Toolbar aria-label="File actions" surface={false}>
            <ToolbarLink
              tooltip="Open full page"
              aria-label="Open full page"
              href={fullPage}
              onClick={(event) => followInApp(event, () => navigate(fullPage))}
            >
              <IconArrowUpRight size={16} stroke={1.5} />
            </ToolbarLink>
          </Toolbar>
        }
      />
      {fileView.body}
    </div>
  ) : null

  const rightPanel = selected ? dmView.rightPanel : (filePane ?? dmView.rightPanel)
  const threadPanel = selected ? dmView.threadPanel : filePane ? fileView.threadPanel : undefined

  return (
    <DeskPageView
      railClosed={railClosed}
      loading={deskLoading || starredLoading}
      screener={debug.desk.showScreener ? screenerItems : []}
      onOpenScreener={openScreener}
      onDismissScreener={dismissScreener}
      onLaterScreener={laterScreener}
      urgent={urgentItems.map((item) => ({
        id: item.id,
        kind: 'dm' as const,
        name: item.name,
        avatarSrc: item.avatarSrc,
        isUnread: true,
        isUrgent: true,
        isSelected: isSelectedIn('urgent', item.dmId),
        onClick: () => selectDm(item.dmId, item.name, 'urgent'),
      }))}
      openWork={openWorkItems.map((item) =>
        item.kind === 'file'
          ? {
              id: item.id,
              kind: 'file' as const,
              name: item.title,
              isBareFile: item.object.kind === KIND_BARE_FILE,
              isUnread: showFileUnreads && fileUnread[item.object.ref] === true,
              isSelected: isOpen(item.address, 'openWork'),
              onClick: () => openFile(item.address, item.title, 'openWork'),
              onRemove: () => dismissOpenWork(item.id),
            }
          : {
              id: item.id,
              kind: 'dm' as const,
              name: item.name,
              avatarSrc: item.avatarSrc,
              isUnread: (showPeopleUnreads && dmHasUnread(item.dmId)) || Boolean(item.isUnread),
              isSelected: isSelectedIn('openWork', item.dmId),
              onClick: () => selectDm(item.dmId, item.name, 'openWork'),
              onRemove: () => dismissOpenWork(item.id),
            },
      )}
      starred={starredEntries.map((entry) => ({
        id: entry.id,
        kind: 'dm' as const,
        name: entry.name,
        avatarSrc: entry.avatarSrc,
        isUnread: (showPeopleUnreads && dmHasUnread(entry.dmId)) || Boolean(entry.isUnread),
        isSelected: isSelectedIn('starred', entry.dmId),
        onClick: () => selectDm(entry.dmId, entry.name, 'starred'),
      }))}
      rightPanel={rightPanel}
      threadPanel={threadPanel}
    />
  )
}

/**
 * One row on the Desk, whichever section it is in, with every decision already
 * made — which is what lets the four sections stop repeating the same branch
 * with the selection worked out inline.
 */
export interface DeskRow {
  id: string
  /*
    A file joined DMs on 23 September (FOL-34): Open work holds files. It
    opens in the Desk's right column like a DM (SID-3), drawing the same
    conversation as the file's own page.
  */
  kind: 'dm' | 'file'
  name: string
  avatarSrc?: string
  /** Files only: a bare-file topic wears the topic glyph, anything else the file one. */
  isBareFile?: boolean
  isUnread: boolean
  isUrgent?: boolean
  isSelected: boolean
  onClick: () => void
  /** Open work only: the ✕ that takes it off the list. */
  onRemove?: () => void
}

function DeskRows({ rows }: { rows: DeskRow[] }) {
  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {rows.map((row) => (
        <PersonRow
          key={row.id}
          name={row.name}
          type={row.kind === 'dm' ? 'DM' : row.isBareFile ? 'topic' : 'file'}
          avatarSrc={row.avatarSrc}
          isUnread={row.isUnread}
          isUrgent={row.isUrgent}
          isSelected={row.isSelected}
          onClick={row.onClick}
          onRemove={row.onRemove}
        />
      ))}
    </div>
  )
}

/**
 * The Desk's body, handed everything it draws — the half a story can show
 * (UIG-17). `DeskPage` above reads, selects and routes; this one only draws.
 *
 * Every section hides itself when it is empty, except Open work, which says
 * what it is for instead — an empty Desk with four headings over nothing is a
 * page that looks broken, and an empty Open work is the one a person is meant
 * to fill.
 */
export function DeskPageView({
  railClosed,
  loading,
  screener,
  onOpenScreener,
  onDismissScreener,
  onLaterScreener,
  screenerPreviewFor,
  urgent,
  openWork,
  starred,
  rightPanel,
  threadPanel,
}: {
  railClosed: boolean
  /** The first read, still in flight. Not the same as an empty Desk. */
  loading: boolean
  /** Empty hides the section entirely. */
  screener: ComponentProps<typeof ScreenerSection>['items']
  onOpenScreener: ComponentProps<typeof ScreenerSection>['onOpen']
  onDismissScreener: ComponentProps<typeof ScreenerSection>['onDismiss']
  onLaterScreener: ComponentProps<typeof ScreenerSection>['onLater']
  /** Passed straight to the section; see its note. */
  screenerPreviewFor?: ComponentProps<typeof ScreenerSection>['previewFor']
  urgent: DeskRow[]
  openWork: DeskRow[]
  starred: DeskRow[]
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}) {
  return (
    <AppShell
      leftPanel={
        <ListColumn title="Desk" collapsed={railClosed}>
          {loading ? (
            <SkeletonSidebarList rows={8} />
          ) : (
            <>
              {screener.length > 0 && (
                <>
                  <ScreenerSection
                    items={screener}
                    onOpen={onOpenScreener}
                    onDismiss={onDismissScreener}
                    onLater={onLaterScreener}
                    previewFor={screenerPreviewFor}
                  />
                  <Divider className="my-2" />
                </>
              )}

              {urgent.length > 0 && (
                <>
                  <div className="flex flex-col">
                    <SectionHeader title="Urgent" hover="none" />
                    <DeskRows rows={urgent} />
                  </div>
                  <Divider className="my-2" />
                </>
              )}

              <div className="flex flex-col">
                {/* The package's section row (UIG-14, 10.2): its actions always
                    shown, and the row itself still under the pointer — the
                    buttons light up on their own (Katerina, 19 September).
                    "Add to Open work" went with the topic picker it opened
                    (FOL-23); a DM and a file are added from where they are. */}
                <SectionHeader
                  title="Open work"
                  showActions="always"
                  hover="none"
                  actions={[
                    // Sort does nothing yet, as before.
                    { icon: <IconSortDescending size={16} stroke={1.5} />, tooltip: 'Sort by', onClick: () => {} },
                  ]}
                />
                {openWork.length === 0 ? (
                  <p className="px-2 py-1 text-caption leading-snug text-text-muted">
                    Organize what you want to read, write, work on now, soon, or simply keep it open for the very first moment once you have time for it.
                  </p>
                ) : (
                  <DeskRows rows={openWork} />
                )}
              </div>

              <Divider className="my-2" />

              {/* Starred — the package's CollapsibleSection (§4.8, D42): the same
                  32px row, but the title is a button, the rows slide, and this
                  browser remembers the fold. It was a hand-drawn copy of
                  ui/StarredSection until 2026-09-10 (Peek scan F10). */}
              <CollapsibleSection title="Starred" storageKey="peek.desk.starred" contentClassName="gap-0.5 mt-1">
                {starred.length === 0 ? (
                  // Level with the rows (Katerina, 2026-09-14): each PersonRow pads itself,
                  // so the line takes a row's inset here, never on EmptyState.
                  <div className="px-2 py-1">
                    <EmptyState scope="section" message="Favorite the conversations of People you interact mostly with" />
                  </div>
                ) : (
                  starred.map((row) => (
                    <PersonRow
                      key={row.id}
                      name={row.name}
                      type="DM"
                      avatarSrc={row.avatarSrc}
                      isUnread={row.isUnread}
                      isSelected={row.isSelected}
                      onClick={row.onClick}
                    />
                  ))
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
  )
}
