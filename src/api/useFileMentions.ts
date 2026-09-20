import { useCallback, useEffect, useState } from 'react'
import { fileMentionsAsViewer, type FileMention } from '@/nostr/fileMentions'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { useRelayViewer } from './foreign'
import { hasConvex } from './store'

/**
 * The comments elsewhere that name this file — a file page's Activity
 * (CON-11), `useTopicMentions`'s shape with the address already in hand.
 *
 * ## Read from the relay, and only from it
 *
 * A file's conversation has no Convex row (`fileConversation.ts`), so there
 * is nothing else to ask. The relay indexes the `a` tag and answers in one
 * filter across every Folder the viewer is in; ADR 0001's point holds here
 * too — a mention written in Ship, or by an app nobody here has heard of, is
 * on the relay and nowhere else.
 *
 * ## Refresh
 *
 * No socket path. The live client watches by Folder, and a mention can be
 * written in any Folder the viewer is in; a `#a` subscription is what would
 * drive this and the client does not expose one. Focus, visibility and the
 * slow interval re-read (PEE-2), which is the fallback every relay read here
 * keeps anyway, and a mention written in another tab shows on the next glance
 * rather than the same second.
 *
 * A refused read keeps the last answer. A list that empties because a token
 * expired reads as "nobody mentions this any more", which is a lie the
 * connection indicator should tell instead — so an outage lights it
 * (`recordReadFailure`) and the rows stay.
 */
export function useFileMentions(address: string | null | undefined): { mentions: FileMention[] } {
  const viewer = useRelayViewer()
  const file = address ?? null
  const [resolved, setResolved] = useState<{ file: string; mentions: FileMention[] }>()

  const load = useCallback(async (): Promise<{ file: string; mentions: FileMention[] } | null> => {
    if (!file) return null
    const v = viewer()
    if (!v) return null
    try {
      return { file, mentions: await fileMentionsAsViewer(file, v.relayUrl, v.token) }
    } catch (error) {
      const kind =
        error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] file mentions read failed:', error)
      return null
    }
  }, [file, viewer])

  useEffect(() => {
    if (!hasConvex || !file) return
    let cancelled = false
    void load().then((next) => next && !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [file, load])

  useRefreshTriggers(
    () => {
      // A slow read for the previous file must not paint over the next one.
      void load().then((next) => next && next.file === file && setResolved(next))
    },
    { enabled: hasConvex && !!file },
  )

  return { mentions: resolved?.file === file ? resolved.mentions : EMPTY }
}

const EMPTY: FileMention[] = []
