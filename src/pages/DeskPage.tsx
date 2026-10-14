import { useCallback, useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useLastSelection } from '@/lib/lastSelection'
import { usePagePicture } from '@/lib/pagePicture'
import { IconSortDescending, IconX } from '@tabler/icons-react'
import { isArchived } from '@estiva-app/interop'
import { Chip, CollapsibleSection, EmptyState, ListColumn, NavItem } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { useRailClosed } from '@/layouts/railClosed'
import { Divider } from '@/components/ui/Divider'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { TopicState } from '@/components/ui/TopicState'
import { ScreenerSection } from '@/components/ScreenerSection'
import { useDmConversationView } from '@/components/views/useDmConversationView'
import { useFilePane } from '@/components/views/useFilePane'
import { useFileView } from '@/components/views/useFileView'
import {
  dmNameById,
  useUnread,
  hasRelay,
  useScreenerItems,
  useDeskItems,
  useDeskLoading,
  usePeekActions,
  useStarred,
  useLiveConversationBadges,
  useOpenWorkFiles,
  useAvatarSrc,
} from '@/api'
import { fileGlyph, type FileGlyph } from '@/lib/fileGlyph'
import { SkeletonSidebarList } from '@/components/ui/Skeleton'
import { useDebug } from '@/lib/debug'

type SectionKey = 'urgent' | 'openWork' | 'starred'

type Selected = { dmId: string; dmName: string; section: SectionKey }

/** How long after a row click its "open the reply's thread" still applies: the views judge within a second or two. */
const OPEN_REPLY_WINDOW_MS = 5000

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
  const [searchParams, setSearchParams] = useSearchParams()
  const { state: debug } = useDebug()
  const { entries: starredAll, isDmStarred, toggleDm, isLoading: starredLoading } = useStarred()
  const deskLoading = useDeskLoading()
  const actions = usePeekActions()
  const allScreenerItems = useScreenerItems()
  const { openWork: OPEN_WORK_ITEMS, urgent: URGENT_ITEMS } = useDeskItems()
  /*
    What Desk had open comes back when the person returns (Katerina, 5
    October), as People's last DM does: the file is the URL's, which the
    rail's Desk link carries; the DM and where the file was clicked from are
    the session's memory, read once as the page mounts.
  */
  const { desk: remembered, setLastDesk } = useLastSelection()
  const location = useLocation()
  const [selected, setSelected] = useState<Selected | null>(() =>
    remembered?.dm && !new URLSearchParams(location.search).get('open') ? (remembered.dm as Selected) : null,
  )
  /*
    The file open beside the lists (SID-3), in the URL rather than in state, so
    a reload or a pasted Desk link keeps it open — and its thread with it, as
    on the file's own page. A DM stays in state, as it always has.
  */
  const openAddress = searchParams.get('open')
  const openThreadId = searchParams.get('thread') ?? undefined
  /** Which section the open file was clicked in, and the title its row showed. Lost on a reload. */
  const [openedFrom, setOpenedFrom] = useState<{ section: SectionKey; title: string } | null>(() =>
    remembered?.openedFrom && remembered.search === location.search ? (remembered.openedFrom as { section: SectionKey; title: string }) : null,
  )
  useEffect(() => {
    setLastDesk({ search: location.search, dm: selected ?? undefined, openedFrom: openedFrom ?? undefined })
  }, [location.search, selected, openedFrom, setLastDesk])
  const [dismissedScreenerIds, setDismissedScreenerIds] = useState<Set<string>>(new Set())
  const [dismissedOpenWorkIds, setDismissedOpenWorkIds] = useState<Set<string>>(new Set())
  /** The file address or DM a row click just opened, until its view says whether only a reply is new (CON-34). */
  const openReplyFor = useRef<{ target: string; at?: number } | null>(null)
  const [rowClicks, setRowClicks] = useState(0)
  const armOpenReply = (target: string) => {
    openReplyFor.current = { target }
    setRowClicks((n) => n + 1)
  }

  // The 1–2 item caps are a demo-composition affordance for the mock dataset.
  // With a real backend the Screener IS the inbox and Urgent is real — capping
  // them would silently hide incoming messages.
  const screenerItems = (hasRelay ? allScreenerItems : allScreenerItems.slice(0, debug.desk.screenerItemsCount))
    .filter((i) => !dismissedScreenerIds.has(i.id))

  const urgentItems = debug.desk.showUrgent
    ? hasRelay
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
    armOpenReply(address)
    setSearchParams({ open: address })
  }
  const closeFile = () => {
    setOpenedFrom(null)
    setSearchParams({}, { replace: true })
  }
  const selectDm = (dmId: string, fallbackName: string, section: SectionKey) => {
    const dmName = dmNameById(dmId) ?? fallbackName
    if (openAddress) closeFile()
    armOpenReply(dmId)
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
    const inUrgent = urgentItems.some((u) => u.kind === 'dm' && u.dmId === selected.dmId)
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
    The open file, as its own page draws it (OPT-12, Miky 7 October: "It
    should be the very same and no link to full page. There is only one
    page."): the conversation, a composer, the thread or the Overview in the
    third column, the read marker, and the page's header — its members, Join,
    and the file's menu. Only the left column is the Desk's: its lists.
  */
  const fileView = useFileView({
    address: selected ? null : openAddress,
    openThreadId,
    onOpenThread: setOpenThread,
    titleHint: openedFrom?.title,
  })
  const openSection = openedFrom?.section ?? 'openWork'
  const filePaneParts = useFilePane(fileView, {
    // The Desk stays the Desk (Miky, OPT-12's kickoff): a deleted file's pane closes, and a new topic opens here.
    onDeleted: () => closeFile(),
    onStarted: (created) => openFile(created.address, created.title, openSection),
  })
  /*
    A row lit only by a thread reply opens that thread (CON-34, Miky
    2026-10-05). Opening a file or DM reads its top-level messages, not the
    reply, so without this the click leaves the dot lit and the person hunting
    for why. Armed by every row click and answered once the opened view has
    judged: nothing new, or a new top-level message, opens it as before.

    Each click is its own answer (`rowClicks`), so a second click on the row
    already open still opens its thread. A judgement that comes later than
    `OPEN_REPLY_WINDOW_MS`, or after the person opened a thread themselves,
    opens nothing: a thread appearing long after a click would be its own surprise.
  */
  const openedTarget = selected ? selected.dmId : openAddress
  const judgedThread = selected ? dmView.replyOnlyThread : fileView.replyOnlyThread
  const openDmThread = dmView.openThread
  const openedDm = selected !== null
  useEffect(() => {
    const armed = openReplyFor.current
    // Stamped by the first pass after the click: the render the click caused cannot read the clock.
    if (armed && armed.at === undefined) armed.at = Date.now()
    if (!armed || armed.target !== openedTarget || judgedThread === undefined) return
    openReplyFor.current = null
    if (!judgedThread || Date.now() - (armed.at ?? 0) > OPEN_REPLY_WINDOW_MS) return
    if (openedDm) openDmThread(judgedThread)
    else if (!openThreadId) setOpenThread(judgedThread)
  }, [rowClicks, openedTarget, judgedThread, openedDm, openDmThread, setOpenThread, openThreadId])

  // A new tab showed the saved Desk until now; a plain Desk is kept for the next one.
  usePagePicture('desk', !(deskLoading || starredLoading), !openAddress && !selected)

  const filePane = openAddress ? filePaneParts.pane : null

  const rightPanel = selected ? dmView.rightPanel : (filePane ?? dmView.rightPanel)
  const threadPanel = selected ? dmView.threadPanel : filePane ? fileView.threadPanel : undefined

  return (
    <>
    {filePaneParts.dialogs}
    <DeskPageView
      railClosed={railClosed}
      loading={deskLoading || starredLoading}
      screener={debug.desk.showScreener ? screenerItems : []}
      onOpenScreener={openScreener}
      onDismissScreener={dismissScreener}
      onLaterScreener={laterScreener}
      urgent={urgentItems.map((item) =>
        item.kind === 'file'
          ? {
              id: item.id,
              kind: 'file' as const,
              name: item.title,
              glyph: fileGlyph(item.fileKind),
              isUnread: true,
              isUrgent: true,
              href: deskFileHref(item.address),
              isSelected: isOpen(item.address, 'urgent'),
              onClick: () => openFile(item.address, item.title, 'urgent'),
            }
          : {
              id: item.id,
              kind: 'dm' as const,
              name: item.name,
              avatarSrc: item.avatarSrc,
              isUnread: true,
              isUrgent: true,
              href: personHref(item.dmId),
              isSelected: isSelectedIn('urgent', item.dmId),
              onClick: () => selectDm(item.dmId, item.name, 'urgent'),
            },
      )}
      openWork={openWorkItems.map((item) =>
        item.kind === 'file'
          ? {
              id: item.id,
              kind: 'file' as const,
              name: item.title,
              glyph: fileGlyph(item.object.kind),
              isUnread: showFileUnreads && fileUnread[item.object.ref] === true,
              // Archived where it lives, and still here: Open work is the person's own list (Katerina, 14 October).
              archived: isArchived(item.object),
              href: deskFileHref(item.address),
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
              href: personHref(item.dmId),
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
        href: personHref(entry.dmId),
        isSelected: isSelectedIn('starred', entry.dmId),
        onClick: () => selectDm(entry.dmId, entry.name, 'starred'),
      }))}
      rightPanel={rightPanel}
      threadPanel={threadPanel}
    />
    </>
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
  /** Files only: the glyph `fileGlyph` gives it — a topic, a Ship project or issue, or a file. */
  glyph?: FileGlyph
  isUnread: boolean
  isUrgent?: boolean
  isSelected: boolean
  /**
   * Where the row's link goes: a file's Desk address, a DM's People page. A
   * plain click opens it here instead, beside the lists (`onClick`); the link
   * is for a new tab, and for what a link says to assistive tech.
   */
  href: string
  onClick: () => void
  /** Open work only: the ✕ that takes it off the list. */
  onRemove?: () => void
  /** Open work only: archived where it lives. The row stays, and says so while it is pointed at. */
  archived?: boolean
}

/** A file open on the Desk: the address `openFile` puts in the URL. */
const deskFileHref = (address: string) => `/app/desk?${new URLSearchParams({ open: address })}`
/** A DM has no Desk address of its own: its link is the person's page. */
const personHref = (dmId: string) => `/app/people/${dmId}`

/**
 * A plain click opens the row on the Desk; a click with a modifier, or not
 * the main button, is left to the link, so a new tab still opens it.
 */
function inPlace(open: () => void) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    open()
  }
}

/** One Desk row on the package's sidebar row, as the Folders tree's rows are. */
function DeskRowItem({ row }: { row: DeskRow }) {
  const avatarSrcFor = useAvatarSrc()
  const type = row.kind === 'dm' ? 'DM' : (row.glyph ?? 'file')
  return (
    <NavItem
      href={row.href}
      label={row.name}
      icon={
        <TopicState
          type={type}
          status={type === 'topic' ? 'unresolved' : 'default'}
          avatarSrc={row.avatarSrc ?? (row.kind === 'dm' ? avatarSrcFor(row.name) : undefined)}
          iconClassName={row.isSelected || row.isUnread ? 'text-text-primary' : undefined}
        />
      }
      active={row.isSelected}
      unread={row.isUnread}
      urgent={row.isUrgent}
      onClick={inPlace(row.onClick)}
      hint={row.archived ? <Chip type="neutral" label="Archived" /> : undefined}
      action={row.onRemove ? { icon: <IconX size={16} stroke={1.5} />, tooltip: 'Remove from list', onClick: row.onRemove } : undefined}
    />
  )
}

function DeskRows({ rows }: { rows: DeskRow[] }) {
  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {rows.map((row) => (
        <DeskRowItem key={row.id} row={row} />
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
    <PeekFrame
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
                  starred.map((row) => <DeskRowItem key={row.id} row={row} />)
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
