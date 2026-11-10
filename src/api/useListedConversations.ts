import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { isCommentOn } from '@estiva-app/conversation'
import {
  listedConversationsOf,
  relayNamesTeams,
  watchListedConversations,
  type ForeignObject,
  type ListedConversation,
  type ListedConversations,
  type ListedWatch,
  type QueryFn,
} from '@estiva-app/interop'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import { viewerQuery } from '@/nostr/foreign'
import { heldOrRelay, readConversation } from '@/nostr/conversationCatchUp'
import { getLiveClient, getLiveTopics } from '@/nostr/liveTopics'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
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
  /**
   * A file with no team has no key in the tab's store: its conversation as read, never live. A file with one keeps
   * its last read here too, drawn if the tab's store let it go before anything subscribed to it.
   */
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
  // The list, by value: the same files are the same read, in any order (a move reads nothing again; TOPI-5).
  const key = listed ? listed.map((file) => file.address).sort().join('\n') : null
  const latest = useRef(listed)
  useEffect(() => {
    latest.current = listed
  })
  const [read, setRead] = useState<Read>()
  /** Read the files again: the open read's, set while it is open. */
  const refreshNow = useRef<(() => void) | null>(null)

  useEffect(() => {
    const files = latest.current
    if (key === null || !files || !relayUrl || !pubkey) return
    const at = viewer()
    if (!at) return
    let stopped = false
    let watch: ListedWatch | undefined
    const query = viewerQuery(at.relayUrl, at.token)
    const store = conversationsFor(at.relayUrl, at.token.pubkey)

    /** Hear each file's new events live, from what `answer` holds: opened again after every read, for the ids it found. */
    const listen = (answer: ListedConversations, held: readonly HeldFile[]) => {
      watch?.stop()
      watch = undefined
      const client = getLiveClient(at.relayUrl)
      if (!client || stopped) return
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
    }

    /*
      The read, and every read after it. The first holds each file's conversation as read; a later one — on focus,
      on becoming visible, on the socket coming back, and on the slow tick while it is down, as a file's own pane
      catches up — asks the same one `listedConversationsOf` again (about three requests for all the files, never one
      catch-up per file) and merges what it returns into each held conversation through the path live events take,
      so what the watch missed while the socket was down is drawn. One at a time; one asked for meanwhile runs after.
    */
    let reading = false
    let again = false
    const readAll = async (first: boolean): Promise<void> => {
      if (reading) {
        again = true
        return
      }
      reading = true
      try {
        let pass = 0
        do {
          // A read asked for while the first was out is a later read: it merges, and a failure keeps what is drawn.
          if (pass++ > 0) first = false
          again = false
          const startedAt = Date.now()
          const answer = await listedConversationsOf(
            query,
            files.map((file) => file.listed),
          )
          if (stopped) return
          const held: HeldFile[] = []
          for (const one of answer.files) {
            const container: ConversationContainer | null = one.folder ? { kind: 'file', address: one.address, h: one.folder } : null
            const roots = rootsOf(one)
            const storeKey = container ? conversationKey(container) : null
            if (container && storeKey && !first && store.since(storeKey) !== undefined) {
              await syncHeld(container, roots, at, one.events)
            } else {
              /*
                Its own events answer the fold; what is not a conversation's (an owner's manifest) goes to the relay,
                and so does an id its events do not hold: whether a reply's parent still exists is the relay's answer,
                as in the file's own pane, never "not among this file's events, so deleted".
              */
              const local: QueryFn = async (filters) => {
                const found = one.events.filter((event) => filters.some((filter) => matchesFilter(event, filter)))
                const have = new Set(found.map((event) => event.id))
                const ask = filters.flatMap((filter) => {
                  if (!Array.isArray(filter.ids)) return []
                  const missing = (filter.ids as string[]).filter((id) => !have.has(id))
                  return missing.length ? [{ ...filter, ids: missing }] : []
                })
                return ask.length ? [...found, ...(await query(ask))] : found
              }
              const { value, events } = await readConversation(container ?? { kind: 'file', address: one.address, h: '' }, roots, heldOrRelay(local, query))
              if (container && storeKey) {
                store.replace(storeKey, value, events, startedAt)
                store.touch(storeKey)
              }
              held.push({ file: one.file, address: one.address, folder: one.folder, container, roots, fixed: value })
              continue
            }
            held.push({ file: one.file, address: one.address, folder: one.folder, container, roots, fixed: storeKey ? store.value(storeKey) : undefined })
          }
          if (stopped) return
          setRead({ key, files: held })
          listen(answer, held)
        } while (again && !stopped)
      } catch (error) {
        const kind = error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
        if (isOutage(kind)) recordReadFailure(kind)
        console.warn('[nostr] listed conversations read failed:', error)
        // A later read that fails keeps what is drawn, as a file's own pane keeps its conversation.
        if (!stopped && first) setRead({ key, failed: kind })
      } finally {
        reading = false
      }
    }
    void readAll(true)
    refreshNow.current = () => void readAll(false)

    // The socket coming back: what was said while it was down is read again.
    let unwatchState: (() => void) | undefined
    try {
      const live = getLiveTopics(at.relayUrl)
      let wasLive = live.state() === 'live'
      unwatchState = live.onState((next) => {
        if (next === 'live' && !wasLive) void readAll(false)
        wasLive = next === 'live'
      })
    } catch (error) {
      console.warn('[nostr] listed conversations cannot hear the socket come back:', error)
    }

    return () => {
      stopped = true
      refreshNow.current = null
      unwatchState?.()
      watch?.stop()
    }
  }, [key, relayUrl, pubkey, viewer])

  // Focus and becoming visible always; the slow tick only while the socket is not live, as a file's own pane does.
  const socketLive = useSocketLive(key !== null ? relayUrl : undefined)
  useRefreshTriggers(() => refreshNow.current?.(), { enabled: key !== null, interval: !socketLive })

  /*
    A list changed in this tab (Add file, Remove) is read again; meanwhile the files still listed stay drawn, so the
    column does not empty and fill again under the reader.
  */
  const stillListed = new Set(key ? key.split('\n') : [])
  const current: Read | undefined =
    read && read.key === key ? read : read && 'files' in read ? { key: read.key, files: read.files.filter((file) => stillListed.has(file.address)) } : undefined
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
      // Let go by the tab's store before anything subscribed (a topic listing more files than it holds): its last read.
      const conversation = (file.container ? conversations.get(conversationKey(file.container)) : undefined) ?? file.fixed
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

const NOT_LIVE = () => () => {}

/** Whether the tab's socket is live, as it changes; false with no relay. */
function useSocketLive(relayUrl: string | undefined): boolean {
  const live = useMemo(() => {
    if (!relayUrl) return null
    try {
      return getLiveTopics(relayUrl)
    } catch {
      return null
    }
  }, [relayUrl])
  const subscribe = useMemo(() => (live ? (listener: () => void) => live.onState(() => listener()) : NOT_LIVE), [live])
  return useSyncExternalStore(subscribe, () => live?.state() === 'live')
}

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
