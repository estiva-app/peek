import { useCallback, useEffect, type MouseEvent, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IconArrowUpRight, IconBell, IconBellFilled, IconDotsVertical, IconX } from '@tabler/icons-react'
import { Breadcrumb, ContainerHeader, ScrollArea, Toolbar, ToolbarButton, ToolbarLink } from '@estiva-app/ui'
import { nestingOf } from '@estiva-app/interop'
import { AppShell } from '@/layouts/AppShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { TopicMoreMenu } from '@/components/ui/TopicMoreMenu'
import { FolderTree } from '@/components/views/FolderTree'
import { ForeignConversationView } from '@/components/views/ForeignConversationView'
import { FileThreadView } from '@/components/views/FileThreadView'
import { useFileControls } from '@/components/views/useFileControls'
import { useFileConversationView } from '@/components/views/useFileConversationView'
import { FileActivityPanel } from '@/components/FileActivityPanel'
import { FileWidgetPanel } from '@/components/FileWidgetPanel'
import {
  useFileAddress,
  rememberFileAddress,
  useFileThreads,
  useFolderContents,
  useFollows,
  useForeignConversation,
  useOpenWorkFiles,
  useTopics,
  useWorkspaceDirectory,
  type ConversationContainer,
  type ForeignConversationState,
} from '@/api'
import { useFileMentions } from '@/api/useFileMentions'
import { canStartInside, fileControlsOf, hasFileControls } from '@/lib/fileControls'
import { addressFromRef, filePath, identifierFromRef, shareableFileUrl, shortFilePath, topicPath } from '@/lib/objectUrl'
import { useFolderPath } from '@/lib/useFolderPath'
import { followInApp } from '@/lib/followInApp'
import { referenceLink } from '@/lib/referenceLink'
import { useLastSelection } from '@/lib/lastSelection'
import { scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { rememberRecent } from '@/lib/recents'
import { useMarkFileRead } from '@/lib/useMarkRead'
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
 * The short form used to be the Convex channel topic's. Those now live at
 * `/topic-old/`, and a link that still names one — its uuid is a channel's, and
 * `TOPICS` holds it as a `folderId` — is sent there rather than resolved as a
 * file it can never be: a migrated topic's file got a fresh uuid (FOL-25), so
 * no `d` is both.
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
    about. `/topic-old/<uuid>` is where a topic is read, and `TopicsPage`
    canonicalises the URL once it knows the title. Decided before the read, so
    the redirect costs no round trip.
  */
  const topicIdentifier = address?.startsWith(`${KIND_TOPIC}:`) ? address.split(':')[2] : null
  /*
    The short form: a `d` and nothing else (FOL-37). A Convex topic's link
    carried a channel uuid in the same position, so the uuid is first tried
    against the topics list — in memory already, no read — and only a uuid no
    topic owns is looked up as a file.
  */
  const identifier = ref && !address ? identifierFromRef(ref) : null
  const topics = useTopics()
  const legacyTopic = identifier ? topics?.find((t) => t.folderId === identifier) : undefined
  const shortForm = useFileAddress(word, legacyTopic ? null : identifier)
  const fileAddress = topicIdentifier
    ? null
    : (address ?? (typeof shortForm === 'object' && 'address' in shortForm ? shortForm.address : null))
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const people = useWorkspaceDirectory()

  /*
    The address is the reference. `resolveObject` takes an naddr, an nevent or a
    bare address — `referenceToPointer`'s tolerance, which exists so a widget
    rendered from an `a` tag is actionable and not merely visible — so nothing
    has to be encoded to bech32 on the way in.
  */
  const { state: resolved, reload: reloadConversation } = useForeignConversation(fileAddress)
  // A short link that resolved to no address is as dead as an address that resolved to nothing.
  const conversation: ForeignConversationState =
    shortForm === 'unresolved' || (typeof shortForm === 'object' && 'failed' in shortForm) ? shortForm : resolved
  const file = typeof conversation === 'object' && 'ref' in conversation ? conversation : null

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
    The dwell marks this file's own stream and no container (FOL-16). Passing
    `file?.address` rather than the address from the URL is deliberate: an
    address that resolved to nothing was never read, and marking it would clear
    a dot for a file the person never saw.
  */
  useMarkFileRead(file?.address)

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
  const comments = file?.comments ?? []
  const rootIds = comments.map((comment) => comment.id)
  /*
    Which view, decided by the manifest and not by the kind (FOL-31). A file
    the viewer may comment on — a bare file's built-in manifest declares
    `comment`, and so does Ship's for a project and an issue — gets Peek's own
    conversation view: the Topics cards, composer and thread pane over
    `kind:1111`. A file the viewer may only look at keeps the read-only panes.
    The two reads are exclusive, so a page pays for one of them and never both.

    And only with somewhere to write (PEE-33). Peek's view needs the Folder the
    comment goes in, and a file that resolved without one — a record with
    neither `h` nor a channel of its own, after `useForeignConversation` has
    asked — cannot have it; handing the view no container left the column
    loading for ever, since the view answers a null container with nothing.
    Such a file keeps the read-only panes, which draw its comments off the
    same resolve: a conversation one can read and not write in, never a spinner.
  */
  const canComment = !!file?.naddr && (file.actions ?? []).some((a) => a.id === 'comment')
  const container: ConversationContainer | null =
    canComment && file?.address && file.folder ? { kind: 'file', address: file.address, h: file.folder } : null
  const ownView = container !== null
  const title = file?.slots.title?.value ?? 'File'
  const peek = useFileConversationView({
    container,
    rootIds,
    openThreadId,
    onOpenThread: setOpenThread,
    title,
    onCommented: reloadConversation,
  })
  const { state: threads } = useFileThreads(ownView ? null : file?.address, rootIds)
  /*
    Activity — the comments elsewhere that name this file (CON-11), read by
    `#a` off the relay for a file Peek's own view draws. It takes the third
    column when no thread is open and there is something to show; the file's
    own conversation is the middle column, and a mention is not part of it
    (`isCommentOn` keeps the two apart on the read).
  */
  const { mentions } = useFileMentions(ownView ? file?.address : null)
  /*
    The third column while no thread is open (FOL-29): another app's file has
    its widget there, and under it the Activity above when there is any. A
    bare file gets no widget — it is nobody's, so there is no other app whose
    part of it the column could show, and its title is already the header —
    and a file nobody has named keeps its two columns as before. "Another
    app's" is `referenceLink`'s answer, the one place Peek says which files
    live inside it: a file whose way in is a link out to its owner is the one
    whose widget is worth a column. No kind number here, and a manifest from
    an app nobody has written lands the same way Ship's does.
  */
  const home = file ? referenceLink(file.naddr ?? file.address ?? file.ref, file) : null
  const widget = file && home?.place === 'app' ? <FileWidgetPanel file={file} /> : undefined
  const activity = mentions.length > 0 ? <FileActivityPanel mentions={mentions} /> : undefined
  const aside =
    widget || activity ? (
      <div className="flex h-full flex-col">
        {widget}
        {activity}
      </div>
    ) : undefined
  const replyCounts =
    threads === 'loading' || 'failed' in threads
      ? undefined
      : Object.fromEntries(
          Object.entries(threads.replies).map(([id, replies]) => [id, replies.length]),
        )
  const openThread = openThreadId ? comments.find((c) => c.id === openThreadId) : undefined

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
  const threadDrawn = peek.threadPanel !== undefined
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
  const startsInside = canStartInside(file)

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
  const { state: team, reload: reloadTeam } = useFolderContents(file?.folder)
  const teamFiles = typeof team === 'object' && 'files' in team ? team.files : undefined
  const listedSelf = file && teamFiles?.find((candidate) => candidate.ref === file.ref)
  const ancestors = listedSelf && teamFiles ? nestingOf(teamFiles).ancestorsOf(listedSelf) : []
  const trail =
    file?.folder && ancestors.length > 0
      ? [
          {
            label: (typeof team === 'object' && 'name' in team ? team.name : undefined) ?? 'Team',
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
    Follow / unfollow (FOL-30): the unread dot exists only for what the person
    follows, and this is where they say so for the file in front of them. The
    state shows in the button itself (pressed = followed), not on hover. Absent
    while the relay has not said what is followed — a toggle then would write
    a guess over the person's list, and the seam refuses it anyway.
  */
  const follows = useFollows()
  const followed = file?.address ? follows.isFollowed(file.address) : false
  const toggleFollow =
    file?.address && follows.state !== 'unknown' ? () => void follows.setFollowed(file.address!, !followed) : undefined

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

  if (topicIdentifier) return <Navigate to={`/topic-old/${topicIdentifier}`} replace />
  // A Convex topic's old short link: the same page it always opened, at its new prefix.
  if (legacyTopic) return <Navigate to={`${topicPath(legacyTopic)}${location.search}`} replace />

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
        nav={
          <FolderTree
            currentFolder={file?.folder}
            selectedRef={file?.ref}
            selectedParent={file?.parentRef}
            onControl={fileControls.open}
            currentContents={file?.folder ? team : undefined}
          />
        }
        rightPanel={
        <div className="flex h-full flex-col">
          <ContainerHeader
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
                {file?.appName && (
                  <p className="truncate text-caption text-text-muted">In {file.appName}</p>
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
                  {toggleFollow && (
                    <ToolbarButton
                      tooltip={followed ? 'Unfollow' : 'Follow'}
                      aria-label={followed ? 'Unfollow' : 'Follow'}
                      pressed={followed}
                      onClick={toggleFollow}
                    >
                      {followed ? <IconBellFilled size={16} stroke={1.5} /> : <IconBell size={16} stroke={1.5} />}
                    </ToolbarButton>
                  )}
                  {/*
                    The topic's menu, when the manifest offers anything for it
                    to hold (FOL-33) — and absent, not inert, when it does not:
                    a Ship issue's header has nothing to put here, and a button
                    that opens nothing would say otherwise.
                  */}
                  {(hasFileControls(controls) || startsInside || toggleOpenWork) && (
                    <TopicMoreMenu
                      trigger={
                        <ToolbarButton tooltip="More actions" aria-label="More actions">
                          <IconDotsVertical size={16} stroke={1.5} />
                        </ToolbarButton>
                      }
                      onOpenDetails={hasFileControls(controls) ? () => fileControls.open('details', file) : undefined}
                      onCopyLink={hasFileControls(controls) ? copyLink : undefined}
                      openWorkAction={toggleOpenWork ? (inOpenWork ? 'remove' : 'add') : undefined}
                      onToggleOpenWork={toggleOpenWork}
                      onRename={controls.rename ? () => fileControls.open('rename', file) : undefined}
                      onNewSubTopic={startsInside && file ? () => fileControls.open('inside', file) : undefined}
                      onMove={controls.move && file ? () => fileControls.open('move', file) : undefined}
                      onDeleteTopic={controls.delete ? () => fileControls.open('delete', file) : undefined}
                    />
                  )}
                </Toolbar>
              ) : undefined
            }
          />
          {ownView ? (
            peek.conversation
          ) : (
            /* The package's bar, not the browser's (D40). */
            <ScrollArea className="min-h-0 flex-1">
              <ForeignConversationView
                state={conversation}
                people={people}
                onOpenThread={setOpenThread}
                openThreadId={openThreadId}
                replyCounts={replyCounts}
              />
            </ScrollArea>
          )}
        </div>
        }
        threadPanel={
        ownView ? (
          // The thread is what somebody just asked for; the widget and Activity are what the page shows otherwise.
          (peek.threadPanel ?? aside)
        ) : openThread ? (
          <div className="flex h-full flex-col">
            <ContainerHeader
              title="Thread"
              actions={
                <IconButton
                  tooltip="Close"
                  aria-label="Close thread"
                  onClick={() => setOpenThread(null)}
                >
                  <IconX size={16} stroke={1.5} />
                </IconButton>
              }
            />
            <ScrollArea className="min-h-0 flex-1">
              <FileThreadView root={openThread} state={threads} people={people} />
            </ScrollArea>
          </div>
        ) : (
          aside
        )
        }
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
export function FilePageView({ nav, rightPanel, threadPanel }: {
  /**
   * The navigation column. The page hands over its wired `FolderTree`; a story
   * hands over `FolderTreeView` with a fixture, which is the only way this
   * column can be drawn at all outside the app — the wired one reads a relay.
   */
  nav?: ReactNode
  rightPanel?: ReactNode
  threadPanel?: ReactNode
}) {
  return <AppShell leftPanel={nav} rightPanel={rightPanel} threadPanel={threadPanel} />
}
