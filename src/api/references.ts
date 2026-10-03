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

/** Called while `[`'s list is open; told when a tier or a search answer changes. */
export function subscribeReferences(listener: () => void): () => void {
  listeners.add(listener)
  const unsubscribe = search.subscribe(listener)
  return () => {
    listeners.delete(listener)
    unsubscribe()
  }
}

// Built on each read: the caption names people, and the directory fills in late.
function messageCandidate(message: ConversationMessage, tier: number, at: number): ReferenceCandidate {
  return {
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
  forgetIfSomeoneElse()
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
