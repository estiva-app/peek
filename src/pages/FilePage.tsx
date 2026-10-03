import { useCallback, useEffect, type MouseEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconArrowUpRight, IconDotsVertical, IconUserCheck, IconUserPlus } from '@tabler/icons-react'
import { Breadcrumb, Panel, Toolbar, ToolbarButton, ToolbarLink } from '@estiva-app/ui'
import { nestingOf } from '@estiva-app/interop'
import { AppShell } from '@/layouts/AppShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { TopicMoreMenu } from '@/components/ui/TopicMoreMenu'
import { FolderTree } from '@/components/views/FolderTree'
import { useFileControls } from '@/components/views/useFileControls'
import { useFileView } from '@/components/views/useFileView'
import {
  useFileAddress,
  rememberFileAddress,
  useFolderContents,
  useMembership,
  useOpenWorkFiles,
  useReferenceFolder,
  useWorkspaceDirectory,
} from '@/api'
import { ArchivedNotice } from '@/components/ArchivedNotice'
import { kindNoun } from '@/lib/archiveWords'
import { canMove, canStartInside, fileControlsOf, hasFileControls } from '@/lib/fileControls'
import { addressFromRef, filePath, identifierFromRef, shareableFileUrl, shortFilePath } from '@/lib/objectUrl'
import { channelDestination, legacyTopicByChannel } from '@/lib/legacyTopicLinks'
import { useFolderPath } from '@/lib/useFolderPath'
import { followInApp } from '@/lib/followInApp'
import { useLastSelection } from '@/lib/lastSelection'
import { scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { rememberRecent } from '@/lib/recents'
import { elsewhereAppName } from '@/lib/appName'
import { KIND_TOPIC } from '@/nostr/foreign'

/**
 * `/<word>/<slug>-<d>` and `/topic/<address>` — one file, in three panes
 * (FOL-19, FOL-37, FOL-39).
 *
 * **One page shape for every file, Peek's or anybody's.** RFC 0.5 §10.7 says
 * Peek is where a file's conversation is read; this is the page that claim
 * needs. A Ship issue, a Ship project, a Peek bare file and a record from an
 * app nobody has written open here identically — navigation on the left, the
 * conversation in the middle, one thread on the right, or the owning app's
 * widget while no thread is open (FOL-29) — because the address is the whole
 * of what the route carries and everything else comes off the owner's
 * manifest at runtime. Nothing in this file knows what Ship is, and a kind
 * number here would turn the page into an integration.
 *
 * ## Why it replaced a pane on the Folder page
 *
 * FOL-17 opened a file as `?file=<address>` beside its Folder's listing, which
 * meant the file had to *be in that listing*: a child resolved against its
 * peers. A Ship issue is not a peer of anything — it is its project's child,
 * fetched from the project's manifest when somebody expands the row — so a
 * pasted link to one opened the Folder and nothing else. That gap is the ticket.
 * Here the address is resolved on its own, and the listing is navigation rather
 * than the source of truth: the Folder comes off the resolved file (`h`), the
 * parent off `parentRef`, and the left pane opens to where the file is.
 *
 * ## Two grammars, one route
 *
 * `/<word>/<slug>-<d>` is a file in the short form §7 gives every object —
 * `/topic/` for a bare file (FOL-37), `/project/` and `/issue/` for Ship's,
 * and whatever word any other manifest declares (FOL-39, §7.7) — and
 * `/topic/<address>` is any file at all. `addressFromRef` tells them apart
 * without fetching anything — an address carries two colons and a slug
 * carries none. The short form costs one `#d` query over the word's kinds to
 * recover the author (`useFileAddress`), after which both grammars resolve
 * identically, and a file opened from the long form is canonicalised to the
 * short one the way `TopicsPage` refreshes a stale slug. The word itself is
 * not checked here: one nobody declares resolves over every declared kind,
 * so a link with a word Peek has not heard of still opens the file it names.
 *
 * The short form used to be the Convex channel topic's. A link that still names
 * one — its uuid is a channel's, and `legacyTopicLinks` holds it — is sent on
 * to that topic's file (FOL-26) rather than resolved as a file it can never be:
 * a migrated topic's file got a fresh uuid (FOL-25), so no `d` is both.
 *
 * ## Reading marks the file, and nothing else
 *
 * SPEC §11.1–§11.2 and FOL-16: the dwell advances `fileContext(address)` only.
 * A topic page advances its container, and this page must not, because the
 * person is reading one file's talk and not the team's general chat — a sibling
 * in the same Folder stays exactly as unread as it was. Verified against Ship's
 * issue page, which marks only the issue.
 */
export function FilePage() {
  const { word = 'topic', ref } = useParams<{ word: string; ref: string }>()
  const address = ref ? addressFromRef(ref) : null
  /*
    A topic is not a file page. A `39000:` address resolves — it is a real
    addressable event — but its conversation is `kind:9` messages carrying `h`
    and no `a`, so this page would draw it as a file nobody has said anything
    about. A retired topic's channel lands on the file its conversation moved
    to, and any other channel — a team — on its Folder (FOL-26). Decided before
    the read, so the redirect costs no round trip.
  */
  const topicIdentifier = address?.startsWith(`${KIND_TOPIC}:`) ? address.split(':')[2] : null
  /*
    The short form: a `d` and nothing else (FOL-37). A Convex topic's link
    carried a channel uuid in the same position, so the uuid is first tried
    against the retired topics' table — in the bundle, no read — and only a
    uuid no topic owned is looked up as a file.
  */
  const identifier = ref && !address ? identifierFromRef(ref) : null
  const legacyTopic = identifier ? legacyTopicByChannel(identifier) : undefined
  const shortForm = useFileAddress(word, legacyTopic ? null : identifier)
  const fileAddress = topicIdentifier
    ? null
    : (address ?? (typeof shortForm === 'object' && 'address' in shortForm ? shortForm.address : null))
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  /*
    Which thread is open, in the URL rather than in state, so a thread is a
    link — the same argument `?file=` was given and the same one §7 makes about
    a topic: a conversation somebody can point at is worth more than one that
    only exists in this tab.
  */
  const openThreadId = searchParams.get('thread') ?? undefined
  const setOpenThread = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams)
      if (id) next.set('thread', id)
      else next.delete('thread')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  /*
    The conversation, its thread and its read marker — shared with the Desk's
    pane (SID-3), so a file is the same conversation wherever it opens.
  */
  const view = useFileView({
    address: fileAddress,
    // A short link that resolved to no address is as dead as an address that resolved to nothing.
    override:
      shortForm === 'unresolved' || (typeof shortForm === 'object' && 'failed' in shortForm) ? shortForm : undefined,
    openThreadId,
    onOpenThread: setOpenThread,
  })
  const { conversation, file, previous, reload: reloadConversation, title, rootIds } = view
  /*
    What the sidebar draws while the next file resolves (SID-2): the one it
    drew last. A click in the tree changes the address and nothing else is
    known until the resolve answers, and handing the tree `undefined` for that
    long shut the open Folder, unmounted its rows with their expand state, and
    re-read the team from cold. Only while loading — a link that resolved to
    nothing lets go of it, as before.
  */
  const navFile = file ?? (conversation === 'loading' ? (previous ?? null) : null)

  /*
    Canonicalise (FOL-37, FOL-39), the way `TopicsPage` does: a file reached
    from its long form, from a short link whose slug a rename has left stale,
    or under a word its own app did not declare, is given the URL `filePath`
    writes for it now that its title and kind are known. The identity in the
    URL is what resolved and the rest is decoration, so this needs no redirect
    table — and it is what makes the address bar the link to copy. Only a kind
    with a declared word has a short form; any other kind's long form is
    already canonical and is left alone.
  */
  const shortFormAddress = file?.address ?? null
  const canonicalPath = shortFormAddress ? shortFilePath(shortFormAddress, file?.slots.title?.value) : null
  useEffect(() => {
    if (canonicalPath && shortFormAddress && location.pathname !== canonicalPath) {
      // The short form carries no author; the page has one, so the replace costs no read.
      rememberFileAddress(shortFormAddress)
      navigate(`${canonicalPath}${location.search}`, { replace: true })
    }
  }, [canonicalPath, shortFormAddress, location.pathname, location.search, navigate])

  /*
    The launcher's Recent (UIG-29), which only `TopicsPage` fed until FOL-36 —
    so a topic started since #194, which is a bare file and opens here, was
    never recent. Written once the file has resolved, with the title the
    header shows, since a file has no live list the launcher could read a
    title from (`lib/recents`).
  */
  const resolvedAddress = file?.address
  const fileTitle = file?.slots.title?.value
  useEffect(() => {
    if (resolvedAddress && fileTitle) rememberRecent({ kind: 'file', id: resolvedAddress, title: fileTitle })
  }, [resolvedAddress, fileTitle])

  /*
    A link to a comment lands on the comment (FOL-36) — `ObjectPage`'s and the
    launcher's one-shot, the same one the topic view answers (RIC-16), read
    here for a comment whose thread is one of this file's. The thread comes
    open from the URL; what is left is the scroll, and it can only happen once
    the thread pane has drawn the comment's anchor, which `peek.threadPanel`
    being something says. Waiting on that rather than on the mount is what
    makes a cold load work: the pane draws a read or more after the file does.
    The one-shot is consumed only once it is answered, so a link that opens
    while the reads are still in flight is not lost to them.
  */
  const { pendingTopicMessage, setPendingTopicMessage } = useLastSelection()
  const { threadDrawn } = view
  useEffect(() => {
    if (!pendingTopicMessage || !rootIds.includes(pendingTopicMessage.eventId)) return
    if (openThreadId !== pendingTopicMessage.eventId) {
      setOpenThread(pendingTopicMessage.eventId)
      return
    }
    if (!threadDrawn) return
    setPendingTopicMessage(null)
    void scrollToMessageWhenReady(pendingTopicMessage.reply ?? pendingTopicMessage.eventId)
  }, [pendingTopicMessage, rootIds, openThreadId, threadDrawn, setOpenThread, setPendingTopicMessage])

  /*
    Rename and Delete, from the manifest and not from the kind (FOL-33) — the
    same gate as `canComment` a few lines up. A bare file's built-in manifest
    declares both; Ship's declares neither for an issue, so an issue's header
    keeps only "Open folder", which is the ticket's test. The dialogs are the
    page's, shared with the tree's row menu so both ends open the same ones
    (PEE-2). A rename re-reads the file, whose title the header draws (the
    tree re-reads on the change event's own signal); deleting the open file
    lands on the team it was in, since this page no longer resolves. A row's
    delete of some other file stays here — the person was not looking at it.
  */
  const controls = fileControlsOf(file)
  // "Details" and Copy link stay where they were: on a file with a
  // rename, a delete or a move. Archive alone (a Ship issue) adds only itself.
  const hasTopicControls = !!controls.rename || !!controls.delete || !!controls.move
  const startsInside = canStartInside(file)
  const people = useWorkspaceDirectory()

  /*
    Where the file sits (FOL-4): its team, then every file above it, each a
    link. Walked in the team's listing (`nestingOf`), which is the one read
    that knows a moved file's parent and which holds every ancestor — a
    sub-file is in its parent's team — so the trail costs no request per level.
    The tree's section for this team is handed the same read rather than
    making its own. Drawn only for a file with something above it: a trail of
    one says nothing the header's title does not.
  */
  const folderPath = useFolderPath()
  const { state: team, reload: reloadTeam } = useFolderContents(navFile?.folder)
  const teamFiles = typeof team === 'object' && 'files' in team ? team.files : undefined
  // This Folder's files are `[`'s first Files tier while the page is open (PEE-21).
  useReferenceFolder(team)
  /*
    The row that was clicked is selected at once when the team's listing has
    it, which it does for any bare file there — the listing is already in hand,
    so this costs no read. One it does not hold, an issue under its project,
    keeps the last selection until the resolve answers.
  */
  const clicked =
    !file && navFile && fileAddress ? teamFiles?.find((candidate) => candidate.address === fileAddress) : undefined
  const selected = file ?? clicked ?? navFile
  const listedSelf = file && teamFiles?.find((candidate) => candidate.ref === file.ref)
  const ancestors = listedSelf && teamFiles ? nestingOf(teamFiles).ancestorsOf(listedSelf) : []
  const trail =
    file?.folder && ancestors.length > 0
      ? [
          {
            label: (typeof team === 'object' && 'name' in team ? team.name : undefined) ?? 'Folder',
            href: folderPath(file.folder),
            onClick: (event: MouseEvent<HTMLAnchorElement>) => followInApp(event, () => navigate(folderPath(file.folder!))),
          },
          ...ancestors.map((above) => {
            const path = filePath(above.address!, above.slots.title?.value)
            return {
              label: above.slots.title?.value ?? 'Untitled',
              href: path,
              onClick: (event: MouseEvent<HTMLAnchorElement>) => followInApp(event, () => navigate(path)),
            }
          }),
        ]
      : undefined

  const fileControls = useFileControls({
    onRenamed: () => void reloadConversation(),
    /*
      The page draws the notice off the file, and the tree lists it or not —
      both re-read. An archived row's file leaves the tree; the page stays on
      it, since a link still opens an archived file.
    */
    onArchived: () => void Promise.all([reloadConversation(), reloadTeam()]),
    onDeleted: (deleted) => {
      if (deleted.folder && deleted.address === file?.address) navigate(`/app/folders/${deleted.folder}`, { replace: true })
    },
    // The trail and the tree both draw the file's place, and both read the team.
    onMoved: () => void Promise.all([reloadConversation(), reloadTeam()]),
    // Into the new topic, as the header's New topic does: it is what was asked for.
    onStarted: (created) => navigate(filePath(created.address, created.title)),
  })

  /*
    Copy link (FOL-37) — the topic header's affordance (PEE-17), for a file: the
    URL `filePath` writes, which for a topic in a Folder is the short form the
    page has just canonicalised to. The same fallback as the topic header's,
    for a browser that refuses the clipboard off a menu.
  */
  const copyLink = file?.address
    ? () => {
        const link = shareableFileUrl(file.address!, file.slots.title?.value, window.location.origin)
        void navigator.clipboard?.writeText(link).catch(() => window.prompt('Copy this link:', link))
      }
    : undefined

  /*
    Join / leave (SPEC §11.8, CON-19): the unread dot exists only for the files
    the person is a member of, and this is where they say so for the file in
    front of them. Writing in it, being mentioned or assigned already makes
    them one; Join is for the rest, Leave is theirs alone to give. The state
    shows in the button itself (pressed = a member), not on hover. Absent while
    the relay has not said what the person is a member of — a toggle then would
    write a guess, and the seam refuses it anyway.
  */
  const membership = useMembership()
  const member = file?.address ? membership.isMember(file.address) : false
  const toggleMember =
    file?.address && file.folder && membership.state !== 'unknown'
      ? () => void membership.setMember(file.address!, file.folder!, !member)
      : undefined

  /*
    Open work (FOL-34): the topic menu's Add/Remove, for a file, by its address.
    Offered for any addressable file, a Ship issue included — which is why the
    menu below now opens for one, holding this and nothing else.
  */
  const openWorkFiles = useOpenWorkFiles()
  const inOpenWork = file?.address ? openWorkFiles.has(file.address) : false
  const toggleOpenWork = file?.address
    ? () => (inOpenWork ? openWorkFiles.remove(file.address!) : openWorkFiles.add(file.address!))
    : undefined

  /*
    Archived (FOL-46): the file is out of every list, and a link still opens
    it — so the page says so first, with the resolution, and offers the way
    back. Its own archive is restored here; one hidden with its parent (an
    issue of an archived project) is restored on the parent, which the notice
    opens instead. The menu's item states the direction that works.
  */
  const archive = file?.archived
  const archivedWith = archive?.with
  const archiveAction = controls.archive && !archivedWith ? (archive ? 'unarchive' : 'archive') : undefined
  const notice =
    file && archive ? (
      <ArchivedNotice
        archive={archive}
        by={people?.[archive.by]?.displayName ?? `${archive.by.slice(0, 8)}…`}
        withWhat={archivedWith ? kindNoun(Number(archivedWith.split(':')[0])) : undefined}
        onUnarchive={archiveAction === 'unarchive' ? () => fileControls.open('unarchive', file) : undefined}
        onOpenParent={archivedWith ? () => navigate(filePath(archivedWith)) : undefined}
      />
    ) : undefined

  if (topicIdentifier) return <Navigate to={channelDestination(topicIdentifier)} replace />
  // A Convex topic's old short link: the file its conversation moved to.
  if (identifier && legacyTopic) return <Navigate to={channelDestination(identifier)} replace />

  if (!address && !identifier) {
    return (
      <div className="flex min-h-screen flex-col">
        <EmptyState message="That link does not point at anything Peek can open." />
      </div>
    )
  }

  return (
    <>
    {fileControls.dialogs}
      <FilePageView
        banner={notice}
        nav={
          <FolderTree
            currentFolder={navFile?.folder}
            selectedRef={selected?.ref}
            selectedParent={selected?.parentRef}
            onControl={fileControls.open}
            currentContents={navFile?.folder ? team : undefined}
          />
        }
        rightPanel={
          // The file's conversation in the package's Panel: it scrolls, and the composer stays under it.
          <Panel
            {...view.panel}
            title={
              <div className="min-w-0">
                {trail && <Breadcrumb items={trail} />}
                <p className="truncate text-body-2-strong text-text-primary">{title}</p>
                {/*
                  Whose file this is, said plainly. The page draws another app's
                  conversation in Peek's own language, which is the point and is
                  also exactly what could mislead: without this the discussion
                  reads as something in Peek.
                */}
                {elsewhereAppName(file) && (
                  <p className="truncate text-caption text-text-muted">In {elsewhereAppName(file)}</p>
                )}
              </div>
            }
            actions={
              file?.folder ? (
                // One strip: one Tab stop, arrows along it (UIG-14).
                <Toolbar aria-label="File actions" surface={false}>
                  {/* A link that looks like the button (UIG-14, 4.13): a new tab works. */}
                  <ToolbarLink
                    tooltip="Open folder"
                    aria-label="Open folder"
                    href={`/app/folders/${file.folder}`}
                    onClick={(event) => followInApp(event, () => navigate(`/app/folders/${file.folder}`))}
                  >
                    <IconArrowUpRight size={16} stroke={1.5} />
                  </ToolbarLink>
                  {toggleMember && (
                    <ToolbarButton
                      tooltip={member ? 'Leave' : 'Join'}
                      aria-label={member ? 'Leave' : 'Join'}
                      pressed={member}
                      onClick={toggleMember}
                    >
                      {member ? <IconUserCheck size={16} stroke={1.5} /> : <IconUserPlus size={16} stroke={1.5} />}
                    </ToolbarButton>
                  )}
                  {/*
                    The topic's menu, when the manifest offers anything for it
                    to hold (FOL-33) — and absent, not inert, when it does not:
                    a Ship issue's header has nothing to put here, and a button
                    that opens nothing would say otherwise.
                  */}
                  {(hasFileControls(controls) || canMove(file) || startsInside || toggleOpenWork) && (
                    <TopicMoreMenu
                      trigger={
                        <ToolbarButton tooltip="More actions" aria-label="More actions">
                          <IconDotsVertical size={16} stroke={1.5} />
                        </ToolbarButton>
                      }
                      onOpenDetails={hasTopicControls ? () => fileControls.open('details', file) : undefined}
                      onCopyLink={hasTopicControls ? copyLink : undefined}
                      archiveAction={archiveAction}
                      onToggleArchive={archiveAction ? () => fileControls.open(archiveAction, file) : undefined}
                      openWorkAction={toggleOpenWork ? (inOpenWork ? 'remove' : 'add') : undefined}
                      onToggleOpenWork={toggleOpenWork}
                      onRename={controls.rename ? () => fileControls.open('rename', file) : undefined}
                      onNewSubTopic={startsInside && file ? () => fileControls.open('inside', file) : undefined}
                      onMove={canMove(file) && file ? () => fileControls.open('move', file) : undefined}
                      onDeleteTopic={controls.delete ? () => fileControls.open('delete', file) : undefined}
                    />
                  )}
                </Toolbar>
              ) : undefined
            }
          />
        }
        threadPanel={view.threadPanel}
      />
    </>
  )
}


/**
 * The file page's body, handed everything it draws — the half a story can show
 * (UIG-17). `FilePage` above resolves the file, reads its conversation and owns
 * its controls; this one only draws, and takes both panes as nodes.
 *
 * The navigation is the Folder tree (FOL-21), opened to the Folder this file
 * lives in and to the row it sits under. Both come off the **resolved file**
 * rather than the URL, which is what lets a bare address open in a fresh tab
 * with the left pane already in the right place — §7.2's property, one level up:
 * the identity in the link is enough, and nothing else has to be carried.
 *
 * `selectedParent` is the file this one names as its parent. `peersOf` hides a
 * child whose parent is listed, so without it a Ship issue would be in the
 * Folder and drawn nowhere — the same shape of gap this route was opened for.
 */
export function FilePageView({ nav, rightPanel, threadPanel, banner }: {
  /** An archived file's notice (FOL-46), at the top of the content area. */
  banner?: ReactNode
  /**
   * The navigation column. The page hands over its wired `FolderTree`; a story
   * hands over `FolderTreeView` with a fixture, which is the only way this
   * column can be drawn at all outside the app — the wired one reads a relay.
   */
  nav?: ReactNode
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}) {
  return <AppShell leftPanel={nav} rightPanel={rightPanel} threadPanel={threadPanel} banner={banner} />
}
