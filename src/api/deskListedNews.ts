/**
 * The listed files' news of the topics on the Desk (ACT-9): what a topic there lights for and lists, as it does in
 * Topics (Miky, 11 Nov). Only the Desk's own topics are read, not all of yours (Miky, 11 Nov: the Desk grows only by
 * that read): their lists (one request), then those files' recent comments and the files one level under them (one
 * request), then a live watch over the answer while the Desk is open. Folded by the column's own `listedNewsOf`, so a
 * topic's dot is judged the same on the Desk and in Topics. When the Topics column already holds a topic's news in
 * this tab, that is used and the topic is not read again.
 */
import { useEffect, useMemo, useState } from 'react'
import { relayNamesTeams, watchTopicActivity, type ActivityFile, type ForeignObject, type TopicActivity } from '@estiva-app/interop'
import { topicActivityAsViewer, topicListsAsViewer } from '@/nostr/foreign'
import { getLiveClient } from '@/nostr/liveTopics'
import { peekRelay } from '@/nostr/relayInfo'
import { useMembership } from '@/api/internal/membership'
import { useRelayViewer } from './foreign'
import type { ListedNews } from './placeDots'
import { activityCommentsOf, activityParentsOf, listedNewsOf, useListedNews } from './useTopicsColumn'
import { hasRelay } from './relayUrl'

interface Read {
  key: string
  lists: Map<string, ActivityFile[]>
  activity: TopicActivity
  /** Bumped by the watch, so the fold sees a comment it appended in place. */
  tick: number
}

export function useDeskListedNews(topics: readonly ForeignObject[]): ReadonlyMap<string, ListedNews> {
  const viewer = useRelayViewer()
  const column = useListedNews()
  const { namedComments } = useMembership()
  // The topics the column has not read: only those are the Desk's to read.
  const ask = useMemo(
    () => topics.filter((topic) => topic.address && !column.has(topic.address)).sort((a, b) => (a.address! < b.address! ? -1 : 1)),
    [topics, column],
  )
  const key = ask.map((topic) => topic.address).join(',')
  const [read, setRead] = useState<Read | null>(null)
  // Who reads, on which relay: the read is asked again only when one of them, or the topics, changes.
  const current = viewer()
  const who = current ? `${current.relayUrl}|${current.token.pubkey}` : ''

  useEffect(() => {
    const v = viewer()
    if (!hasRelay || !v || !key) return
    let stopped = false
    let watch: { stop: () => void } | null = null
    // Heard from when the read was asked, so nothing written while it was out is missed.
    const since = Math.floor(Date.now() / 1000)
    void (async () => {
      try {
        const addresses = key.split(',')
        const lists = await topicListsAsViewer(addresses, v.relayUrl, v.token)
        if (stopped) return
        const activity = await topicActivityAsViewer(
          ask.map((topic) => ({ address: topic.address!, folder: topic.folder ?? null, files: lists.get(topic.address!) ?? [] })),
          v.relayUrl,
          v.token,
        )
        if (stopped) return
        setRead({ key, lists, activity, tick: 0 })
        const client = getLiveClient(v.relayUrl)
        if (!client) return
        const bump = () => setRead((prev) => (prev?.key === key ? { ...prev, tick: prev.tick + 1 } : prev))
        // why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-request-kept-open-hears-what-asking-again-would-return.md
        watch = watchTopicActivity(client.relay, activity, bump, {
          since,
          namesTeams: relayNamesTeams(peekRelay()),
          onClosed: (reason) => console.warn('[nostr] Desk topics watch closed:', reason),
          onComment: bump,
        })
      } catch (error) {
        // The Desk's topics then light for their own talk only, as before; the next Desk open asks again.
        console.warn('[nostr] Desk topics read failed:', error)
      }
    })()
    return () => {
      stopped = true
      watch?.stop()
    }
    // `ask` is `key`'s topics and `viewer` is `who`: keyed on the addresses and the reader, not on identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, key])

  const tick = read?.tick
  return useMemo(() => {
    const own =
      read && read.key === key
        ? listedNewsOf(read.lists, activityCommentsOf(read.activity), activityParentsOf(read.activity), namedComments)
        : new Map<string, ListedNews>()
    if (column.size === 0) return own
    const both = new Map(own)
    for (const topic of topics) if (topic.address && column.has(topic.address)) both.set(topic.address, column.get(topic.address)!)
    return both
    // `tick` stands for the watch's appends to `read.activity`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, tick, key, column, topics, namedComments])
}
