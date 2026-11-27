import { useLocation, useNavigate } from 'react-router-dom'
import { CommandLauncher as Launcher, type LauncherHost, type LauncherMessageRow, type LauncherState, type LauncherWords } from '@estiva-app/launcher'
import { Avatar, showInConversation, showInConversationWhenDrawn } from '@estiva-app/ui'
import { identifierFromRef } from '@estiva-app/interop'
import { PeekLogoMark } from './ui/PeekLogo'
import { ShipLogoMark } from './ui/ShipLogo'
import { PEEK_FORM } from './launcherForm'
import { FilePreviewCard } from './ui/MessageLinks'
import { formatDateLabel, reloadFoldersOnScreen, useFileSearch, useForeignObjects, useMembership, useMessageSearch, useWorkspaceDirectory, useWorkspacePeople } from '@/api'
import { snippetAround } from '@/lib/launcherSearch'
import { addressFromRef, filePath, fileRouteFromPath, fileThreadPath, refNamesFile } from '@/lib/objectUrl'
import { fileGlyphOfAddress } from '@/lib/fileGlyph'
import { referenceOfValue } from '@/lib/embedValue'
import { channelDestination, legacyTopicByChannel } from '@/lib/legacyTopicLinks'
import { canPrefill, downloadModel, hasPromptApi, prefillAvailability, promptForObject, promptForText } from '@/lib/promptApi'
import { openConversation } from '@/lib/threadOpener'
import type { LauncherContext } from '@/lib/launcherContext'
import { insertReferenceIntoActiveComposer, insertTextIntoActiveComposer, insertTextIntoComposer, insertTextWhenComposerOpens } from '@/lib/composerRegistry'
import { activeFolder } from '@/lib/conversationRegistry'
import { useLastSelection } from '@/lib/lastSelection'
import { clearRecents, forgetRecent, useRecents } from '@/lib/recents'
import { previewText } from '@/lib/textParsing'
import { objectLabel } from '@/lib/appName'
import { LAUNCHER_APPS } from '@/lib/launcherActions'
import { useReportFailure } from '@/lib/failureReports'

export type { LauncherState }

/**
 * Peek's launcher (Cmd/Ctrl+K anywhere, or the top bar's search field).
 *
 * **The box is `@estiva-app/launcher`'s since KIN-4**, the same one Leaf and
 * Ship mount: its levels, the search, the prompt, Ask and Draft, the forms and
 * what Escape keeps. This file is what only Peek knows, handed over as the
 * launcher's `host`: Peek's routes, its people, its relay search, the
 * manifest runtime as Peek reaches it, the conversation and composer
 * registries, DMs, recents, the marks and the words that say "Peek" and
 * "conversation".
 */

const WORDS: LauncherWords = {
  anywhere: 'Anywhere in Peek',
  inOpen: 'In this conversation',
  search: 'Search Peek, or choose an app',
  searchOrAsk: 'Search, or ask about this conversation',
  openGroup: 'This conversation',
  nothingOpen: 'Open a conversation to ask about it.',
  nothingYet: 'Nothing has been said here yet.',
  reading: 'Reading the thread…',
  downloadModel: 'Download the on-device model to ask about conversations',
}

const mark = (appId: string, size: number) => (appId === 'peek' ? <PeekLogoMark height={size} /> : <ShipLogoMark height={size} />)

/** A stored body as one line of words — markdown and a heading's marker gone. */
const asWords = (body: string) =>
  previewText(body.replace(/^#{1,6}\s+/gm, ''))
    .replace(/\s*\n+\s*/g, ' ')
    .trim()

/**
 * A retired topic's channel is never somewhere to start a conversation
 * (FOL-26): its conversation is on a file now, and a `kind:9` into it is what
 * FOL-25 has to be sure nothing can write before the channel goes. The relay
 * lists it among the newest `39000`s until then, so it is refused here, by the
 * same table the old links redirect through.
 */
const parentRefusal = (address: string) =>
  address.startsWith('39000:') && legacyTopicByChannel(address.split(':')[2] ?? '')
    ? 'That topic has moved to a file. Open it from Topics and write there.'
    : null

/** A file's card beside the box: the one a link to it draws. A topic has none: its card is its latest conversation, which the box is not for (KIN-3). */
const preview = (id: string) => {
  const uri = fileGlyphOfAddress(id) !== 'topic' ? referenceOfValue(id) : undefined
  return uri ? <FilePreviewCard uri={uri} /> : undefined
}

/** A cited message, shown where it is: in the conversation on screen, or in its own once that is opened (INT-8). */
const showSource = (message: { id: string; conversationId?: string }) => {
  if (showInConversation(message.id)) return true
  // Not on screen: a topic-wide answer cites across conversations.
  if (message.conversationId && openConversation(message.conversationId)) {
    void showInConversationWhenDrawn(message.id)
    return true
  }
  return false
}

const composer: NonNullable<LauncherHost['composer']> = {
  insertText: insertTextIntoActiveComposer,
  insertTextInto: insertTextIntoComposer,
  insertTextWhenOpens: insertTextWhenComposerOpens,
  insertReference: insertReferenceIntoActiveComposer,
}

const afterCreate = () => void reloadFoldersOnScreen()

/**
 * Messages that match, as rows that have somewhere to open.
 *
 * A message names its Folder on the `h` tag. The only channels whose talk
 * has somewhere to open are an old topic's, which lands on the file its
 * conversation moved to — the same table the old links redirect through
 * (FOL-26); the Convex topic rows this joined on went in FOL-23. Any other
 * hit is unroutable. Those are not rows; how many there were is said,
 * because a silent cap reads as "that is all there was".
 *
 * A comment on a file names the file instead (FOL-36), and the file's page
 * resolves the address on its own, so a comment is routable wherever the
 * file is — its `h` is the team's channel, which is not where the comment
 * is anyway.
 */
function usePeekMessageSearch(query: string) {
  const { state, hits } = useMessageSearch(query)
  const directory = useWorkspaceDirectory()
  const navigate = useNavigate()
  const { setPendingTopicMessage } = useLastSelection()
  const typed = query.trim()
  const topicOf = (folder: string | undefined) => (folder ? legacyTopicByChannel(folder) : undefined)
  const routable = hits.filter((h) => h.file || topicOf(h.folder))
  const rows = routable.map((hit): LauncherMessageRow => {
    const topic = hit.file ? undefined : topicOf(hit.folder)
    const who = directory?.[hit.pubkey]
    // The thread is the conversation, and a reply lands on itself once it is open (R13).
    const pending = hit.folder ? { folder: hit.folder, eventId: hit.root ?? hit.id, ...(hit.root ? { reply: hit.id } : {}) } : null
    return {
      id: hit.id,
      // Words, never markdown; the match in context, not the first 80 characters.
      label: snippetAround(asWords(hit.content), typed),
      description: [who?.displayName, hit.fileTitle ?? topic?.title, formatDateLabel(hit.createdAt * 1000)].filter(Boolean).join(' · '),
      leading: <Avatar src={who?.picture} name={who?.displayName} bot={who?.bot === true} size={24} />,
      // The topic, at that message (R13) — the one-shot `ObjectPage` already uses;
      // or the file, with the thread open from the URL and the same one-shot for the scroll.
      open: () => {
        if (pending) setPendingTopicMessage(pending)
        const path = hit.file ? fileThreadPath(hit.file, hit.fileTitle, hit.root ?? hit.id) : null
        if (path) navigate(path)
        else if (topic) navigate(channelDestination(topic.channel))
      },
    }
  })
  return { state, rows, unroutable: hits.length - routable.length }
}

interface CommandLauncherProps {
  /** Captured at the invoking keystroke/click - see lib/launcherContext. */
  context: LauncherContext
  /** The box is finished with: something was chosen or done, or it was dismissed holding nothing. The frame unmounts it. */
  onClose: () => void
  /** Shown or hidden (KIN-2). A hidden box stays mounted with everything it holds. Default shown. */
  open?: boolean
  /** Escape or a click outside while the box holds something: the frame hides it. Without it, dismissing closes. */
  onHide?: () => void
  /** Whether the box holds anything worth keeping, and what the search should say about it while it is hidden. */
  onState?: (state: LauncherState) => void
  /** Open inside an app (tests only). */
  initialAppId?: string
  /** Open with an action's form already up (tests only; needs initialAppId). */
  initialActionId?: string
}

/**
 * The conversation a sentence asked here is about (KIN-12), named the same
 * wherever it is shown. Desk shows every one at `/app/desk`: a file by
 * `?open=`, a DM only in its own memory. So the place is the file's `d`, on
 * its own page or beside Desk's lists, or the DM's id, on People or on Desk;
 * anywhere else the page. A thread open in it is still the same place.
 */
export function placeOf(pathname: string, search: string, deskDmId: string | undefined): string {
  const onDesk = pathname === '/app/desk'
  // A DM picked on Desk is what Desk shows, even with an `?open=` left in the address (Back after picking it).
  if (onDesk && deskDmId) return `dm:${deskDmId}`
  const ref = (onDesk ? new URLSearchParams(search).get('open') : null) ?? fileRouteFromPath(pathname)?.ref
  if (ref) {
    const address = addressFromRef(ref)
    const d = address ? address.split(':').slice(2).join(':') : identifierFromRef(ref)
    // A team's chat beside Desk's lists (`39000:…`) has no `d`: it is still its own place.
    return d ? `file:${d.toLowerCase()}` : `open:${ref}`
  }
  const dm = pathname.startsWith('/app/dms/') ? decoded(pathname.slice('/app/dms/'.length)) : undefined
  return dm ? `dm:${dm}` : pathname
}

/** A path segment as its id was written; one with a stray `%` stays as it is rather than throw. */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Peek's ⌘K box: the shared launcher, mounted with what only Peek knows. */
export function CommandLauncher(props: CommandLauncherProps) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { dmId: selectedPersonId, desk } = useLastSelection()
  /* Where the launcher was opened: a recent that is the page you are on is not somewhere to go (Katerina, 16 September). */
  const openPersonId = pathname.startsWith('/app/dms/') ? selectedPersonId : null
  // A file's page is `/<word>/<slug>-<d>` or `/topic/<address>` (FOL-19, FOL-37, FOL-39); the ref in the path names the file that is open.
  const openFileRef = fileRouteFromPath(pathname)?.ref ?? null
  // The People page's list, keyed by pubkey — a row opens the DM (REM-3).
  const people = useWorkspacePeople()
  const recents = useRecents()
  const { creatableUnder, applyAction, startConversationInDm, resolveObject } = useForeignObjects()
  const { setMember } = useMembership()

  const host: LauncherHost = {
    apps: LAUNCHER_APPS,
    mark,
    words: WORDS,
    path: { pathname, search, place: placeOf(pathname, search, desk?.dm?.dmId) },
    navigate,
    people,
    openPerson: (id) => navigate(`/app/dms/${encodeURIComponent(id)}`),
    isOpenPerson: (id) => id === openPersonId,
    file: {
      glyph: fileGlyphOfAddress,
      open: (id, title) => {
        const path = filePath(id, title)
        if (path) navigate(path)
      },
      isOpen: (id) => !!openFileRef && refNamesFile(openFileRef, id),
      preview,
    },
    recents: { list: recents, forget: forgetRecent, clear: clearRecents },
    useFileSearch,
    useMessageSearch: usePeekMessageSearch,
    plain: asWords,
    manifests: { creatableUnder, applyAction, resolveObject, objectLabel },
    // Read here, not in the package, so the on-device rule and its tests stay with Peek's own module (`lib/promptApi`).
    model: { canPrefill, downloadModel, hasPromptApi, prefillAvailability, promptForObject, promptForText },
    composer,
    showSource,
    form: PEEK_FORM,
    currentFolder: activeFolder,
    parentRefusal,
    startConversationInDm,
    // Each person added becomes a member of the new topic (SPEC §11.8), by the membership seam.
    addMember: (file, folder, person) => setMember(file, folder, true, person),
    afterCreate,
    useReportFailure,
  }

  return <Launcher host={host} {...props} />
}
