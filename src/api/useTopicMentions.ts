import { useCallback, useEffect, useState } from 'react'
import { TOPIC_KIND } from '@/nostr/manifest'
import { relaySigningKeyAsViewer } from '@/nostr/foreign'
import { topicMentionsAsViewer, type TopicMention } from '@/nostr/topicMentions'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { useRelayViewer } from './foreign'
import { setRelaySigningKey, topicAddress } from './mentions'
import { hasConvex } from './store'

/**
 * The messages elsewhere that name this topic — Activity's second relation
 * (CON-11), beside `useFolderProject`'s sub-files.
 *
 * ## Read from the relay, not from Peek's rows
 *
 * Every message Peek has synced carries its `a` tags as `nostrReferences`, so
 * this could be answered by scanning the Convex tables. It is not, for two
 * reasons. The relay indexes the tag and answers in one filter, where Convex
 * has no index over an array field and the scan would be every message in
 * every channel. And ADR 0001: the relay is where a mention *is* — a message
 * written in Ship that names a Peek topic is on the relay and in no Peek row
 * until somebody opens that channel, and Activity should not depend on who has
 * opened what.
 *
 * ## The address needs the relay's key
 *
 * A topic is `39000:<relay-key>:<uuid>` (RFC 0.4 §5.2), and `topicAddress`
 * spells it only once the session has read that key. `MentionTopicSync` reads
 * it once for the `[` menu; a topic opened before that read lands would be
 * asked for with no address, so this reads the key itself when it is still
 * missing and hands it to the same slot. One extra read per session at most,
 * and never one per topic.
 *
 * ## Refresh
 *
 * No socket path yet. The live client watches by channel, and a mention can be
 * written in any channel the viewer is in; a `#a` subscription is what would
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
export function useTopicMentions(
  topic: { folderId?: string | null } | undefined,
  /** Hold every automatic re-read while set, on `useFolderProject`'s terms. */
  pauseWhile?: unknown,
): { mentions: TopicMention[] } {
  const viewer = useRelayViewer()
  const folder = topic?.folderId ?? null
  const [resolved, setResolved] = useState<{ folder: string; mentions: TopicMention[] }>()

  const load = useCallback(async (): Promise<{ folder: string; mentions: TopicMention[] } | null> => {
    if (!folder) return null
    const v = viewer()
    if (!v) return null
    let address = topicAddress({ folderId: folder })
    if (!address) {
      const key = await relaySigningKeyAsViewer(v.relayUrl, v.token)
      if (!key) return null
      setRelaySigningKey(key)
      address = `${TOPIC_KIND}:${key}:${folder}`
    }
    try {
      return { folder, mentions: await topicMentionsAsViewer(address, folder, v.relayUrl, v.token) }
    } catch (error) {
      const kind =
        error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] topic mentions read failed:', error)
      return null
    }
  }, [folder, viewer])

  useEffect(() => {
    if (!hasConvex || !folder) return
    let cancelled = false
    void load().then((next) => next && !cancelled && setResolved(next))
    return () => {
      cancelled = true
    }
  }, [folder, load])

  useRefreshTriggers(
    () => {
      if (pauseWhile) return
      // A slow read for the previous topic must not paint over the next one.
      void load().then((next) => next && next.folder === folder && setResolved(next))
    },
    { enabled: hasConvex && !!folder },
  )

  return { mentions: resolved?.folder === folder ? resolved.mentions : EMPTY }
}

const EMPTY: TopicMention[] = []
