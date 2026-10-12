import { useCallback, useEffect, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { FolderTree } from '@/components/views/FolderTree'
import { useFilePane } from '@/components/views/useFilePane'
import { useFileView } from '@/components/views/useFileView'
import { useFileAddress, rememberFileAddress, useFolderContents, useReferenceFolder } from '@/api'
import { addressFromRef, filePath, identifierFromRef, shortFilePath } from '@/lib/objectUrl'
import { channelDestination, legacyTopicByChannel } from '@/lib/legacyTopicLinks'
import { useLastSelection } from '@/lib/lastSelection'
import { scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { rememberRecent } from '@/lib/recents'
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
  const { conversation, file, previous, rootIds } = view
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
  const { pendingTopicMessage, setPendingTopicMessage, setLastTopicsPath } = useLastSelection()
  /*
    The rail's Topics comes back here (Katerina, 5 October), as People comes
    back to the last DM: going to Desk and back no longer drops the open file.
    Its canonical path, once the address bar has settled on it, with its open
    thread. The Topics page with no file writes its own, so a file closed —
    by a view that does not draw it, by archiving it, by deleting it — is
    never what the rail brings back.
  */
  useEffect(() => {
    if (canonicalPath && location.pathname === canonicalPath) setLastTopicsPath(`${location.pathname}${location.search}`)
  }, [canonicalPath, location.pathname, location.search, setLastTopicsPath])
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
    The team's listing (FOL-4): the one read that holds a moved file's parent,
    handed to the tree's section for this team rather than read twice.
  */
  const { state: team, reload: reloadTeam } = useFolderContents(navFile?.folder)
  const teamFiles = typeof team === 'object' && 'files' in team ? team.files : undefined
  // This Folder's files are `[`'s first Files tier while the page is open, this one left out (PEE-21).
  useReferenceFolder(team, fileAddress)
  /*
    The row that was clicked is selected at once when the team's listing has
    it, which it does for any bare file there — the listing is already in hand,
    so this costs no read. One it does not hold, an issue under its project,
    keeps the last selection until the resolve answers.
  */
  const clicked =
    !file && navFile && fileAddress ? teamFiles?.find((candidate) => candidate.address === fileAddress) : undefined
  const selected = file ?? clicked ?? navFile

  /*
    The middle column, its header and the file's controls — the Desk's too
    (OPT-12), so a topic is one view wherever it opens. The dialogs are the
    page's, shared with the tree's row menu so both ends open the same ones
    (PEE-2). The tree draws the file's place and lists it or not, so an
    archive or a move re-reads the team as well.
  */
  const pane = useFilePane(view, {
    // Gone: its Folder's page takes the rail's memory, so Topics does not lead back to it.
    onDeleted: (deleted) =>
      navigate(deleted.folder ? `/app/folders/${deleted.folder}` : '/app/folders', { replace: true }),
    // Into the new topic, as the header's New topic does: it is what was asked for.
    onStarted: (created) => navigate(filePath(created.address, created.title)),
    onListingChanged: reloadTeam,
  })

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
    {pane.dialogs}
      <FilePageView
        nav={
          <FolderTree
            currentFolder={navFile?.folder}
            selectedRef={selected?.ref}
            selectedParent={selected?.parentRef}
            // Unknown until the file resolves, and until the relay has said what the person joined: the column judges nothing on a guess.
            selectedArchived={file ? !!file.archived : undefined}
            selectedMine={pane.member}
            // Reached from a Ship project's channel link (FoldersPage): the project opens, its issues under it.
            expandSelected={(location.state as { expandSelected?: boolean } | null)?.expandSelected === true}
            onControl={pane.openControl}
            currentContents={navFile?.folder ? team : undefined}
          />
        }
        rightPanel={pane.pane}
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
  // An archived file's notice is in the messages column, in the composer's place (7 October), not the frame's banner.
  return <PeekFrame leftPanel={nav} rightPanel={rightPanel} threadPanel={threadPanel} />
}
