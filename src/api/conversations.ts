import { createConversationStore, type ConversationStore } from '@/platform/conversationStore'
import type { FileConversation } from '@/nostr/fileConversation'
import { LOOKBACK_SECONDS } from './lookback'

/**
 * The tab's held conversations (OPT-3), for this relay and this viewer. A
 * different viewer — signed out and in as somebody else — gets a new store, so
 * nothing one person could read is ever drawn for the next. The channel
 * store's rule (`useChannelStreams`), and its lookback.
 */
let current: { key: string; store: ConversationStore<FileConversation> } | null = null

export function conversationsFor(relayUrl: string, pubkey: string): ConversationStore<FileConversation> {
  const key = `${relayUrl}|${pubkey}`
  if (current?.key === key) return current.store
  current?.store.clear()
  for (const map of besides.values()) map.clear()
  current = { key, store: createConversationStore<FileConversation>({ lookbackSeconds: LOOKBACK_SECONDS }) }
  return current.store
}

const besides = new Map<string, Map<string, unknown>>()

/**
 * A map held beside the conversations — a file's mentions — and emptied with
 * them when the viewer changes. `name` says whose it is.
 */
export function heldBeside<T>(name: string): Map<string, T> {
  let map = besides.get(name)
  if (!map) besides.set(name, (map = new Map()))
  return map as Map<string, T>
}

/** The store key of a container — `useFileConversation`'s. */
export function conversationKey(container: { kind: 'file'; address: string; h: string } | { kind: 'channel'; h: string }): string {
  return container.kind === 'file' ? `file ${container.h} ${container.address}` : `channel ${container.h}`
}

/**
 * Whether a file's conversation is held, so its catch-up will say when the file
 * itself or its mentions changed — and the page's own reads of those need not
 * ask again on a return.
 */
export function isConversationHeld(address: string): boolean {
  return !!current?.store.keys().some((key) => key.startsWith('file ') && key.endsWith(` ${address}`))
}

/** What a file's catch-up found besides its conversation — `CaughtUp`'s, for the page's other reads. */
export interface FileNews {
  /** A field change or a new version of the file. */
  object: boolean
  /** Something new names the file without being a comment on it. */
  mentions: boolean
  /** Who wrote the comments it found. */
  authors: string[]
}

const newsListeners = new Map<string, Set<(news: FileNews) => void>>()

/**
 * Told what a catch-up of `address`'s conversation found. The page's reads
 * that draw from the same events — mentions, members — skip their own read on
 * a return and listen here instead.
 */
export function onFileNews(address: string, listener: (news: FileNews) => void): () => void {
  const set = newsListeners.get(address) ?? new Set()
  set.add(listener)
  newsListeners.set(address, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) newsListeners.delete(address)
  }
}

export function announceFileNews(address: string, news: FileNews): void {
  for (const listener of newsListeners.get(address) ?? []) listener(news)
}

/** Tests start with nothing held. */
export function resetConversationsForTests(): void {
  current?.store.clear()
  current = null
  for (const map of besides.values()) map.clear()
  newsListeners.clear()
}
