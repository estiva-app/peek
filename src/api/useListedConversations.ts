import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isCommentOn } from '@estiva-app/conversation'
import {
  listedConversationsOf,
  relayNamesTeams,
  watchListedConversations,
  type ForeignObject,
  type ListedConversation,
  type ListedWatch,
  type QueryFn,
} from '@estiva-app/interop'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { viewerQuery } from '@/nostr/foreign'
import { heldOrRelay, readConversation } from '@/nostr/conversationCatchUp'
import { getLiveClient } from '@/nostr/liveTopics'
import { peekRelay } from '@/nostr/relayInfo'
import { RelayReadError, classifyRelayFailure, isOutage, type RelayFailureKind } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { matchesFilter } from '@/platform/conversationStore'
import { conversationKey, conversationsFor } from './conversations'
import { useRelayViewer } from './foreign'
import { conversationActions, syncHeld, type ConversationContainer, type FileConversation, type FileConversationActions } from './useFileConversation'
import type { TopicFile } from './useTopicFiles'

/** One file a topic lists, with its conversation, as a topic at All draws it (TOPI-3). */
export interface ListedSource {
  /** The listed file's id. */
  file: string
  address: string
  /** Its team, from its root; null when it names none. */
  folder: string | null
  /** Where a reply in its threads is written: the file, in its own team. Null with no team: its threads are read-only. */
  container: ConversationContainer | null
  conversation: FileConversation
  /** Archived, on its own or with a file above it: its threads are read-only (an-archived-file-is-read-only-in-every-app). */
  archived: boolean
  /** The file as resolved: its title and kind, for its heading. */
  object?: ForeignObject
}

/** `off` while nothing is asked (not at All); `loading` until the first answer for this list. */
export type ListedState = 'off' | 'loading' | { failed: RelayFailureKind } | { files: ListedSource[] }

interface HeldFile {
  file: string
  address: string
  folder: string | null
  container: ConversationContainer | null
  /** Its comment ids as first read: the fold's roots, to which the held events add the newer ones. */
  roots: string[]
  /** A file with no team has no key in the tab's store: its conversation as read, never live. */
  fixed?: FileConversation
}

type Read = { key: string; failed: RelayFailureKind } | { key: string; files: HeldFile[] }

/**
 * The conversations of every file a topic lists — what its middle column draws at All, beside its own (TOPI-3; why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md).
 *
 * One read for all of them (interop's `listedConversationsOf`, about three requests whatever their number), each file
 * folded by Peek's own read code over its events, as its own pane folds it, and held in the tab's conversation store
 * under the file's own key: a write in one of its threads is drawn at once and sent as its pane sends it, and opening
 * the file after draws it at once. Kept live by one watch over all of them (`watchListedConversations`, asking by
 * file alone on our relay), each event applied to its file with no read.
 *
 * Only the files the topic lists, never what is under them (Miky, 2026-11-06). Read again when the list changes,
 * never because a file's title or archive changed.
 */
export function useListedConversations(
  /** The topic's resolved list (`useTopicFiles`), or null when the topic is not followed at All. */
  listed: readonly TopicFile[] | null,
): { state: ListedState; actionsFor: (address: string) => FileConversationActions | undefined } {
  const viewer = useRelayViewer()
  const v = viewer()
  const pubkey = v?.token.pubkey
  const relayUrl = v?.relayUrl
  // The list, by value: the same files in the same order are the same read.
  const key = listed ? listed.map((file) => file.address).join('\n') : null
  const latest = useRef(listed)
  useEffect(() => {
    latest.current = listed
  })
  const [read, setRead] = useState<Read>()

  useEffect(() => {
    const files = latest.current
    if (key === null || !files || !relayUrl || !pubkey) return
    const at = viewer()
    if (!at) return
    let stopped = false
    let watch: ListedWatch | undefined
    const query = viewerQuery(at.relayUrl, at.token)
    const store = conversationsFor(at.relayUrl, at.token.pubkey)
    void (async () => {
      try {
        const startedAt = Date.now()
        const answer = await listedConversationsOf(
          query,
          files.map((file) => file.listed),
        )
        const held: HeldFile[] = []
        for (const one of answer.files) {
          const container: ConversationContainer | null = one.folder ? { kind: 'file', address: one.address, h: one.folder } : null
          const roots = rootsOf(one)
          // Its own events answer the fold; only what is not a conversation's (an owner's manifest) goes to the relay.
          const local: QueryFn = async (filters) => one.events.filter((event) => filters.some((filter) => matchesFilter(event, filter)))
          const { value, events } = await readConversation(container ?? { kind: 'file', address: one.address, h: '' }, roots, heldOrRelay(local, query))
          if (container) {
            const at = conversationKey(container)
            store.replace(at, value, events, startedAt)
            store.touch(at)
          }
          held.push({ file: one.file, address: one.address, folder: one.folder, container, roots, ...(container ? {} : { fixed: value }) })
        }
        if (stopped) return
        setRead({ key, files: held })
        const client = getLiveClient(at.relayUrl)
        if (!client) return
        const byFile = new Map(held.map((file) => [file.file, file]))
        watch = watchListedConversations(
          client.relay,
          answer,
          (file: string, event: SignedEvent) => {
            const source = byFile.get(file)
            if (source?.container) void syncHeld(source.container, source.roots, at, event)
          },
          {
            // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-request-kept-open-hears-what-asking-again-would-return.md
            namesTeams: relayNamesTeams(peekRelay()),
            onClosed: (reason) => console.warn('[nostr] listed conversations watch closed:', reason),
          },
        )
      } catch (error) {
        const kind = error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] listed conversations read failed:', error)
        if (!stopped) setRead({ key, failed: kind })
      }
    })()
    return () => {
      stopped = true
      watch?.stop()
    }
  }, [key, relayUrl, pubkey, viewer])

  const current = read && read.key === key ? read : undefined
  const heldFiles = current && 'files' in current ? current.files : NO_FILES
  const store = relayUrl && pubkey ? conversationsFor(relayUrl, pubkey) : null
  const storeKeys = heldFiles.flatMap((file) => (file.container ? [conversationKey(file.container)] : []))
  const keysJoined = storeKeys.join('\n')

  // Each file's held conversation, as its own pane subscribes to it: a write, a live event or a catch-up redraws it.
  const subscribe = useMemo(() => {
    const keys = keysJoined ? keysJoined.split('\n') : []
    return (listener: () => void) => {
      if (!store) return () => {}
      const stops = keys.map((one) => store.subscribe(one, listener))
      return () => stops.forEach((stop) => stop())
    }
  }, [store, keysJoined])
  const snapshot = useMemo(() => {
    const keys = keysJoined ? keysJoined.split('\n') : []
    let last: readonly (FileConversation | undefined)[] = []
    return () => {
      const next = keys.map((one) => store?.value(one))
      if (next.length === last.length && next.every((value, i) => value === last[i])) return last
      last = next
      return next
    }
  }, [store, keysJoined])
  const values = useSyncExternalStore(subscribe, snapshot)

  const state: ListedState = useMemo(() => {
    if (key === null) return 'off'
    if (!current) return 'loading'
    if ('failed' in current) return { failed: current.failed }
    const byAddress = new Map((listed ?? []).map((file) => [file.address, file]))
    const conversations = new Map(storeKeys.map((one, i) => [one, values[i]]))
    const files: ListedSource[] = []
    for (const file of current.files) {
      const conversation = file.container ? conversations.get(conversationKey(file.container)) : file.fixed
      // Evicted from the tab's store: drawn again on the next read, never as an empty conversation.
      if (!conversation) continue
      const input = byAddress.get(file.address)
      files.push({
        file: file.file,
        address: file.address,
        folder: file.folder,
        container: file.container,
        conversation,
        archived: !!input?.archived,
        ...(input?.object ? { object: input.object } : {}),
      })
    }
    return { files }
    // `storeKeys` is `keysJoined`, by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current, listed, values, keysJoined])

  const actionsFor = (address: string): FileConversationActions | undefined => {
    const file = heldFiles.find((one) => one.address === address)
    const at = viewer()
    if (!file?.container || !at) return undefined
    const container = file.container
    return conversationActions({
      container,
      key: conversationKey(container),
      ids: file.roots.join(','),
      viewer,
      sync: (event) => syncHeld(container, file.roots, at, event),
    })
  }

  return { state, actionsFor }
}

const NO_FILES: readonly HeldFile[] = []

/**
 * A listed file's comments, oldest first: the roots its own pane would be handed by its resolve. A `1111` filed in any
 * team; an owner's older kind only in the file's own, elsewhere it is a mention (`rootsHeld`'s rule).
 */
function rootsOf(one: ListedConversation): string[] {
  const kinds = [KIND.COMMENT, ...one.olderKinds]
  const inFolder = (event: SignedEvent) => event.tags.some((tag) => tag[0] === 'h' && tag[1] === one.folder)
  return [
    ...new Set(
      one.events
        .filter((event) => isCommentOn(event, one.address, kinds) && (event.kind === KIND.COMMENT || inFolder(event)))
        .sort((a, b) => a.created_at - b.created_at)
        .map((event) => event.id),
    ),
  ]
}
