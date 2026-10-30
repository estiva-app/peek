/**
 * What `[` offers in Peek (PEE-21): Files, then Messages (Katerina, 30 Oct),
 * ranked by `@estiva-app/conversation`'s `rankReferences` and put in that
 * order by its `referenceSectionsOf` — the order every app shares.
 *
 * - **Messages:** the open thread's, then its file's (`referenceConversations`).
 * - **Files:** this Folder's — published by the page that shows it
 *   ({@link useReferenceFolder}) — then the files you read recently (your read
 *   markers), then, once you type, relay search.
 *
 * The editor asks synchronously on every keystroke, so the tiers are held here
 * and kept fresh by the components that can read the relay; a search answer
 * landing tells the open list to draw again (`subscribeReferences`).
 */
import { useEffect, useRef } from 'react'
import type { CaptionedItem, ReferenceTriggerOptions } from '@estiva-app/ui/editor'
import {
  FILE_TIER,
  MESSAGE_TIER,
  messageCandidate,
  rankReferences,
  referenceSearch,
  referenceSectionsOf,
  type ReferenceCandidate,
} from '@estiva-app/conversation'
import { urlRunsIn } from '@estiva-app/protocol'
import { KIND_BARE_FILE, type FolderContents, type ForeignObject } from '@estiva-app/interop'
import { referenceConversations, type ConversationMessage } from '@/lib/conversationRegistry'
import { rememberedFile, rememberRecent } from '@/lib/recents'
import { MESSAGE_KIND } from '@/nostr/manifest'
import { personByPubkey } from './mentions'
import { fileCandidatesAsViewer, searchFileReferencesAsViewer } from '@/nostr/foreign'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { askLinks, knownCardValue, onLinksChanged, useRelayViewer } from './foreign'
import type { FolderContentsState } from './useFolderContents'

type ReferenceSection = ReturnType<NonNullable<ReferenceTriggerOptions['sections']>>[number]

/** The section headings, by the package's names for them; the list's name is FILES_MENU_COPY's. */
const REFERENCE_COPY = { files: 'Files', messages: 'Messages' }

/** At most this many links in the offered messages are asked about: each is a read, and `[` asks on every key. */
const MAX_OFFERED_LINKS = 24

/** How many recently read files are looked up — a few more than the section shows. */
const RECENT_LIMIT = 12
const ADDRESS_RE = /^\d+:[0-9a-f]{64}:.+$/

let folderFiles: ReferenceCandidate[] = []
let recentFiles: ReferenceCandidate[] = []
let openFile: string | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

type Viewer = ReturnType<ReturnType<typeof useRelayViewer>>
let viewerNow: () => Viewer = () => null
/** Whose answers the tiers hold. Checked on every read, not left to a re-render. */
let heldFor: string | undefined

function forgetIfSomeoneElse() {
  const pubkey = viewerNow()?.token.pubkey
  if (pubkey === heldFor) return
  heldFor = pubkey
  search.reset()
  recentFiles = []
}

const search = referenceSearch({
  search: async (text) => {
    const v = viewerNow()
    if (!v) return []
    const found = await searchFileReferencesAsViewer(text, v.relayUrl, v.token)
    // Read with someone else's token: never kept for whoever is signed in now.
    if (viewerNow()?.token.pubkey !== v.token.pubkey) throw new Error('signed-in person changed')
    return found
  },
})

/**
 * Called while `[`'s list is open; told when a tier or a search answer
 * changes, and when a link in an offered message comes back, so its caption
 * reads it as what it names.
 */
export function subscribeReferences(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribe = search.subscribe(listener)
  const unlink = onLinksChanged(listener)
  return () => {
    listeners.delete(listener)
    unsubscribe()
    unlink()
  }
}

/*
  The package's row for a message, the same in every app: the author, the
  opening words with an app link read as what it names once it has come back
  (never the raw URL), and found by its own words, not the links in them
  (Katerina, 30 Oct). Built on each read: the caption names people, and the
  directory and the links' answers fill in late.
*/
const messagesOf = (messages: ConversationMessage[], tier: number) =>
  // Oldest first on screen: the position is the recency.
  messages.flatMap((message, at) =>
    message.eventId
      ? [
          messageCandidate(
            { id: message.eventId, kind: MESSAGE_KIND, author: message.author, body: message.body, at },
            tier,
            (pubkey) => personByPubkey(pubkey)?.name,
            { resolveLink: knownCardValue },
          ),
        ]
      : [],
  )

/** Ask what the app links in the offered messages name; a known one costs nothing, and an answer redraws the list. */
function askAboutLinksIn(messages: readonly ConversationMessage[]) {
  const urls = [...new Set(messages.flatMap((message) => urlRunsIn(message.body).map((run) => run.url)))].slice(0, MAX_OFFERED_LINKS)
  if (urls.length) askLinks(urls).catch(() => {})
}

function itemOf(candidate: ReferenceCandidate): CaptionedItem {
  if (candidate.type === 'message') {
    return { id: candidate.id, label: candidate.title, snippet: candidate.caption, uri: candidate.uri, search: candidate.search }
  }
  // The title alone: the row's icon says what it is (Katerina, 7 October), so "Topic:" before it said it twice.
  // A file's summary is the row's second line, and an issue's project moves up beside its title (SUM-7).
  return {
    id: candidate.id,
    label: candidate.title,
    snippet: '',
    uri: candidate.uri,
    description: candidate.caption || undefined,
    summary: candidate.summary,
  }
}

/** The two sections `[` draws for what was typed. */
export function referenceSections(query: string): ReferenceSection[] {
  forgetIfSomeoneElse()
  const { here, parent } = referenceConversations()
  askAboutLinksIn([...here, ...parent])
  const ranked = rankReferences({
    messages: [...messagesOf(here, MESSAGE_TIER.here), ...messagesOf(parent, MESSAGE_TIER.parent)],
    files: [...folderFiles, ...recentFiles, ...search.hits(query)],
    query,
    ownKinds: [KIND_BARE_FILE],
    exclude: openFile ? [openFile] : [],
  })
  return referenceSectionsOf(ranked).map(({ name, items }) => ({ label: REFERENCE_COPY[name], items: items.map(itemOf) }))
}

/**
 * Publishes the Folder on screen as `[`'s first Files tier, and takes it back
 * when the page goes — a DM has no Folder, so its Files start at recently read.
 * `address`, the file open on the page, is never offered under Files: its
 * messages already lead Messages (Miky, 2026-10-03).
 */
export function useReferenceFolder(contents: FolderContentsState | undefined, address: string | null) {
  const viewer = useRelayViewer()
  useEffect(() => {
    openFile = address
    return () => {
      openFile = null
    }
  }, [address])
  const files = contents && typeof contents === 'object' && 'files' in contents ? (contents as FolderContents).files : undefined
  useEffect(() => {
    const v = viewer()
    if (!files || !v) return
    let live = true
    fileCandidatesAsViewer(files, FILE_TIER.folder, v.relayUrl, v.token)
      .then((rows) => {
        if (!live) return
        folderFiles = rows
        notify()
      })
      .catch(() => {})
    return () => {
      live = false
      folderFiles = []
      notify()
    }
  }, [files, viewer])
}

/**
 * Keeps `[`'s recently-read tier in step with your read markers, and forgets
 * every answer when the signed-in person changes (checked again on each
 * read, since this sits above AuthGate). Draws nothing; mounted by
 * PeekDataProvider.
 */
export function ReferenceSourcesSync() {
  const viewer = useRelayViewer()
  const frontier = useReadFrontier()
  const pubkey = viewer()?.token.pubkey

  useEffect(() => {
    viewerNow = viewer
    forgetIfSomeoneElse()
  }, [viewer, pubkey])

  const recent = Object.entries(frontier.merged)
    .filter(([context]) => ADDRESS_RE.test(context))
    .sort((a, b) => b[1] - a[1])
    .slice(0, RECENT_LIMIT)
  const key = `${pubkey}\n${recent.map(([address]) => address).join('\n')}`

  useEffect(() => {
    const v = viewer()
    if (!v || !recent.length) {
      recentFiles = []
      notify()
      return
    }
    let live = true
    const at = new Map(recent)
    fileCandidatesAsViewer({ addresses: [...at.keys()], at }, FILE_TIER.recent, v.relayUrl, v.token)
      .then((rows) => {
        // Answered for whoever asked; dropped if someone else is signed in by now.
        if (!live || viewerNow()?.token.pubkey !== v.token.pubkey) return
        recentFiles = rows
        notify()
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // `key` is who is reading and the addresses `recent` holds; the markers' times alone do not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewer])

  return null
}

/**
 * Puts the file on screen first in the launcher's Recent (FOL-36), with the
 * title the header shows, its summary, and an issue's project (SUM-7) — the
 * row `[` would draw for it, so the two read alike. An issue's project costs
 * one read, and only when the address, title or summary changed, never on a
 * refresh of the same file.
 *
 * The file goes first as soon as its title is known, with what was last
 * remembered for it, so leaving before the read answers still lists it. The
 * answer then brings the summary and project up to date while it is still
 * the file open; a file `[` does not offer is its title alone, as before, and
 * a read that fails keeps what was there and is asked again on the next refresh.
 */
export function useRememberFile(file: ForeignObject | null | undefined) {
  const viewer = useRelayViewer()
  const remembered = useRef('')
  useEffect(() => {
    const id = file?.address
    const title = file?.slots.title?.value
    if (!file || !id || !title) return
    const key = `${id}\n${title}\n${file.slots.subtitle?.value ?? ''}`
    if (remembered.current === key) return
    remembered.current = key
    const known = rememberedFile(id)
    const recent = (row: { summary?: string; caption?: string } | undefined) => ({
      kind: 'file' as const,
      id,
      title,
      ...(row?.summary ? { summary: row.summary } : {}),
      ...(row?.caption ? { caption: row.caption } : {}),
    })
    rememberRecent(recent(known))
    const v = viewer()
    if (!v) return
    fileCandidatesAsViewer([file], FILE_TIER.recent, v.relayUrl, v.token).then(
      ([row]) => {
        if (remembered.current === key) rememberRecent(recent(row))
      },
      () => {
        if (remembered.current === key) remembered.current = ''
      },
    )
  }, [file, viewer])
}
