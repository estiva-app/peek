import { useCallback, useEffect, useState } from 'react'
import { setTopicFileAsViewer, topicFilesAsViewer } from '@/nostr/foreign'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRelayViewer } from './foreign'
import { hasRelay } from './relayUrl'
import { topicListChanged } from './useTopicsColumn'

/** A file a topic lists, resolved: its id and the address it was found at. */
export interface TopicFile {
  file: string
  address: string
}

export type TopicFilesState = 'loading' | { failed: true } | { files: TopicFile[] }

/**
 * A topic's files (TOP-3; SPEC §6.14, why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-topic-keeps-its-own-list-of-files.md),
 * and Add file and Remove on them.
 *
 * Read once when the topic opens and again after each write, never live: a
 * file added in another tab or by somebody else shows on the next open or
 * reload (the project's Not in scope). Each write is read back, since the
 * relay is the authority on whether it happened.
 *
 * A failed read keeps the last answer and lights the connection indicator
 * when it is an outage; with no answer yet it is `failed`, never an empty
 * list, which would say the topic lists nothing.
 */
export function useTopicFiles(
  /** The topic's address, or null where the page has no topic. */
  topic: string | null | undefined,
  /** The topic's Folder, from its root (§6.2): where an entry is filed. */
  folder: string | null | undefined,
): {
  state: TopicFilesState
  /** The ids being added or removed right now. */
  busy: ReadonlySet<string>
  setListed: (file: string, listed: boolean) => Promise<{ ok: true } | { ok: false; reason: string }>
} {
  const viewer = useRelayViewer()
  const address = topic ?? null
  const [held, setHeld] = useState<{ topic: string; state: TopicFilesState }>()
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(async (): Promise<TopicFilesState | null> => {
    const v = viewer()
    if (!address || !v) return null
    try {
      const listed = await topicFilesAsViewer(address, v.relayUrl, v.token)
      return { files: listed.map(({ file, address: at }) => ({ file, address: at })) }
    } catch (error) {
      const kind = error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] topic files read failed:', error)
      return { failed: true }
    }
  }, [address, viewer])

  const take = useCallback(
    (next: TopicFilesState | null) => {
      if (!next || !address) return
      // A failed read after a good one keeps the files drawn.
      setHeld((now) => (typeof next === 'object' && 'failed' in next && now?.topic === address && now.state !== 'loading' ? now : { topic: address, state: next }))
    },
    [address],
  )

  useEffect(() => {
    if (!hasRelay || !address) return
    let cancelled = false
    void load().then((next) => {
      if (!cancelled) take(next)
    })
    return () => {
      cancelled = true
    }
  }, [address, load, take])

  const setListed = useCallback(
    async (file: string, listed: boolean): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const v = viewer()
      if (!address || !folder || !v) return { ok: false, reason: 'Sign in again to change this topic.' }
      setBusy((now) => new Set(now).add(file))
      try {
        const result = await setTopicFileAsViewer({ topic: address, folder, file, listed }, v.relayUrl, v.token)
        take(await load())
        // The Topics column beside it draws the same list (TOP-4).
        if (result.ok) topicListChanged(address)
        return result
      } finally {
        setBusy((now) => {
          const next = new Set(now)
          next.delete(file)
          return next
        })
      }
    },
    [address, folder, viewer, load, take],
  )

  const state: TopicFilesState = held && held.topic === address ? held.state : 'loading'
  return { state, busy, setListed }
}
