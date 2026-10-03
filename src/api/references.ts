/**
 * What `[` offers in Peek (PEE-21): Messages, then Files, ranked by
 * `@estiva-app/conversation`'s `rankReferences` — the order every app shares.
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
import { useEffect } from 'react'
import type { CaptionedItem, ReferenceTriggerOptions } from '@estiva-app/ui/editor'
import {
  FILE_TIER,
  MESSAGE_TIER,
  messageReference,
  rankReferences,
  referenceSearch,
  type ReferenceCandidate,
  type ReferenceType,
} from '@estiva-app/conversation'
import { KIND_BARE_FILE, type FolderContents } from '@estiva-app/interop'
import { referenceConversations, type ConversationMessage } from '@/lib/conversationRegistry'
import { previewText } from '@/lib/textParsing'
import { MESSAGE_KIND } from '@/nostr/manifest'
import { fileCandidatesAsViewer, searchFileReferencesAsViewer } from '@/nostr/foreign'
import { useReadFrontier } from '@/nostr/useReadStateSync'
import { useRelayViewer } from './foreign'
import type { FolderContentsState } from './useFolderContents'

type ReferenceSection = ReturnType<NonNullable<ReferenceTriggerOptions['sections']>>[number]

/** The section headings, Messages above Files; the list's name is FILES_MENU_COPY's. */
const REFERENCE_COPY = { messages: 'Messages', files: 'Files' }

/** The type word a file row and its chip wear (label objects by type). */
const TYPE_WORDS: Record<ReferenceType, string> = { message: 'Message', issue: 'Issue', project: 'Project', topic: 'Topic' }

/** How many recently read files are looked up — a few more than the section shows. */
const RECENT_LIMIT = 12
const ADDRESS_RE = /^\d+:[0-9a-f]{64}:.+$/

let folderFiles: ReferenceCandidate[] = []
let recentFiles: ReferenceCandidate[] = []
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

type Viewer = ReturnType<ReturnType<typeof useRelayViewer>>
let viewerNow: () => Viewer = () => null

const search = referenceSearch({
  search: (text) => {
    const v = viewerNow()
    return v ? searchFileReferencesAsViewer(text, v.relayUrl, v.token) : Promise.resolve([])
  },
})

/** Called while `[`'s list is open; told when a tier or a search answer changes. */
export function subscribeReferences(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribe = search.subscribe(listener)
  return () => {
    listeners.delete(listener)
    unsubscribe()
  }
}

// A message's candidate never changes, so each is built once per tier.
const MESSAGES = new WeakMap<ConversationMessage, ReferenceCandidate>()
function messageCandidate(message: ConversationMessage, tier: number, at: number): ReferenceCandidate {
  const known = MESSAGES.get(message)
  if (known && known.tier === tier && known.at === at) return known
  const candidate: ReferenceCandidate = {
    id: message.eventId as string,
    uri: messageReference(message.eventId as string, MESSAGE_KIND),
    type: 'message',
    kind: MESSAGE_KIND,
    title: message.author,
    caption: previewText(message.body),
    search: message.body,
    tier,
    at,
  }
  MESSAGES.set(message, candidate)
  return candidate
}

const messagesOf = (messages: ConversationMessage[], tier: number) =>
  // Oldest first on screen: the position is the recency.
  messages.flatMap((message, at) => (message.eventId ? [messageCandidate(message, tier, at)] : []))

function itemOf(candidate: ReferenceCandidate): CaptionedItem {
  if (candidate.type === 'message') {
    return { id: candidate.id, label: candidate.title, snippet: candidate.caption, uri: candidate.uri, search: candidate.search }
  }
  return { id: candidate.id, label: TYPE_WORDS[candidate.type], snippet: candidate.title, uri: candidate.uri, description: candidate.caption || undefined }
}

/** The two sections `[` draws for what was typed. */
export function referenceSections(query: string): ReferenceSection[] {
  const { here, parent } = referenceConversations()
  const ranked = rankReferences({
    messages: [...messagesOf(here, MESSAGE_TIER.here), ...messagesOf(parent, MESSAGE_TIER.parent)],
    files: [...folderFiles, ...recentFiles, ...search.hits(query)],
    query,
    ownKinds: [KIND_BARE_FILE],
  })
  return [
    { label: REFERENCE_COPY.messages, items: ranked.messages.map(itemOf) },
    { label: REFERENCE_COPY.files, items: ranked.files.map(itemOf) },
  ]
}

/**
 * Publishes the Folder on screen as `[`'s first Files tier, and takes it back
 * when the page goes — a DM has no Folder, so its Files start at recently read.
 */
export function useReferenceFolder(contents: FolderContentsState | undefined) {
  const viewer = useRelayViewer()
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
    }
  }, [files, viewer])
}

/**
 * Keeps `[`'s recently-read tier in step with your read markers, and forgets
 * every search answer when the signed-in person changes. Draws nothing;
 * mounted by PeekDataProvider.
 */
export function ReferenceSourcesSync() {
  const viewer = useRelayViewer()
  const frontier = useReadFrontier()
  const pubkey = viewer()?.token.pubkey

  useEffect(() => {
    viewerNow = viewer
    search.reset()
    recentFiles = []
  }, [viewer, pubkey])

  const recent = Object.entries(frontier.merged)
    .filter(([context]) => ADDRESS_RE.test(context))
    .sort((a, b) => b[1] - a[1])
    .slice(0, RECENT_LIMIT)
  const key = recent.map(([address]) => address).join('\n')

  useEffect(() => {
    const v = viewer()
    if (!v || !key) return
    let live = true
    const at = new Map(recent)
    fileCandidatesAsViewer({ addresses: [...at.keys()], at }, FILE_TIER.recent, v.relayUrl, v.token)
      .then((rows) => {
        if (!live) return
        recentFiles = rows
        notify()
      })
      .catch(() => {})
    return () => {
      live = false
    }
    // `key` is the addresses `recent` holds; the markers' times alone do not re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, viewer])

  return null
}
