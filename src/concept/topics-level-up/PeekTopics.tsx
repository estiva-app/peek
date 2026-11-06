import { useEffect, useState } from 'react'
import { EmptyState, MenuItem, MenuSeparator } from '@estiva-app/ui'
import { PeekFrame } from '@/layouts/PeekFrame'
import { useToast } from '@/lib/toast'
import { ExplorePage } from './ExplorePage'
import { openWorkKey } from './keys'
import { TopicPage } from './TopicPage'
import { TopicsColumnView } from './TopicsColumn'
import { TOPICS, type Person, type Read, type Topic } from './fixtures'

export type Place = { type: 'none' } | { type: 'topic'; id: string } | { type: 'explore' }

export interface PeekTopicsProps {
  viewer?: Person
  start?: Place
  /** The sidebar's and Explore's read when the story opens. */
  read?: Read
  /** The open topic's conversation and files, when the story opens. */
  topic?: Read
  /** In no topic at all. */
  none?: boolean
  /** Two seconds in, Katerina writes in Onboarding and it moves to the top with its dot. */
  live?: boolean
  openWork?: string[]
}

/**
 * **Peek's Topics, levelled up** (Miky, 3 and 6 Nov), on Peek's own frame
 * (`PeekFrame`: the top bar, the rail with Desk, Topics, Teams and People)
 * with the Topics column and a topic's page beside it, as `TopicsPage` and
 * `FilePage` put them together today. What changes is in `TopicsColumn`,
 * `TopicPage`, `TopicFiles` and `ExplorePage` here, each a copy of the
 * component it changes.
 */
export function PeekTopics({ viewer = 'miky', start = { type: 'topic', id: 'widgets' }, read: firstRead = 'ok', topic: firstTopicRead = 'ok', none = false, live = false, openWork: firstOpenWork = [] }: PeekTopicsProps) {
  const [place, setPlace] = useState<Place>(start)
  const [read, setRead] = useState<Read>(firstRead)
  const [topics, setTopics] = useState<Topic[]>(() => (none ? TOPICS.map((t) => ({ ...t, members: t.members.filter((p) => p !== viewer) })) : TOPICS))
  const [unread, setUnread] = useState<ReadonlySet<string>>(() => new Set(['fast']))
  const [openWork, setOpenWork] = useState<ReadonlySet<string>>(() => new Set(firstOpenWork))
  const [joined, setJoined] = useState<ReadonlySet<string>>(() => new Set())
  const { showToast } = useToast()

  // The sidebar: every topic you're in, newest activity first.
  const mine = topics.filter((t) => !t.archived && (t.members.includes(viewer) || joined.has(t.id))).sort((a, b) => a.at - b.at)
  const current = place.type === 'topic' ? topics.find((t) => t.id === place.id) : undefined

  const toggleOpenWork = (t: Topic) => {
    const had = openWork.has(t.id)
    const flip = () =>
      setOpenWork((s) => {
        const next = new Set(s)
        if (next.has(t.id)) next.delete(t.id)
        else next.add(t.id)
        return next
      })
    flip()
    showToast({ label: had ? 'Taken out of Open work' : 'Added to Open work', type: had ? 'neutral' : 'success', actionLabel: 'Undo', onAction: flip })
  }

  // Ctrl/Cmd+O anywhere on a topic's page adds it to Open work, or takes it out (Miky, 6 Nov).
  useEffect(() => {
    if (!current || current.archived) return
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault()
        toggleOpenWork(current)
      }
    }
    // @estiva-escape(no-rebuilt-behaviour): prototype only. NEW HERE: an app's own key for an action; no kit part binds one yet (the launcher's Ctrl+K is the frame's), so the build adds it to the kit
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Live, as Peek is: a new message moves its topic to the top as it lands (Miky, 6 Nov).
  useEffect(() => {
    if (!live) return
    const timer = setTimeout(() => {
      setTopics((ts) => ts.map((t) => (t.id === 'onb' ? { ...t, at: 0, atLabel: 'Just now' } : t)))
      setUnread((u) => new Set([...u, 'onb']))
    }, 2000)
    return () => clearTimeout(timer)
  }, [live])

  const open = (id: string) => {
    setPlace({ type: 'topic', id })
    setUnread((u) => new Set([...u].filter((x) => x !== id)))
  }

  // A row's "…": only what you do from a list (Miky, 3 Nov). Rename, Move, Archive and Delete are on the topic's page.
  const menu = (t: Topic) => (
    <>
      <MenuItem label={openWork.has(t.id) ? 'Remove from Open work' : 'Add to Open work'} shortcut={openWorkKey()} onClick={() => toggleOpenWork(t)} />
      <MenuItem label="Copy link" onClick={() => showToast({ label: 'Link copied', type: 'success' })} />
      {/* A topic in a team that has spaces; Company's topics have none. */}
      {t.team !== 'Company' && <MenuItem label="Make it a space" />}
      <MenuSeparator />
      <MenuItem label="Leave" />
    </>
  )

  const right =
    place.type === 'explore' ? (
      <ExplorePage
        viewer={viewer}
        read={read}
        joined={joined}
        onJoin={(id) => setJoined((s) => new Set([...s, id]))}
        onOpen={open}
        onRetry={() => setRead('ok')}
      />
    ) : current ? (
      <TopicPage
        key={current.id}
        topic={joined.has(current.id) ? { ...current, members: [...current.members, viewer] } : current}
        viewer={viewer}
        conversation={firstTopicRead}
        files={firstTopicRead}
        inOpenWork={openWork.has(current.id)}
        onToggleOpenWork={() => toggleOpenWork(current)}
      />
    ) : (
      <EmptyState message="No file selected" />
    )

  return (
    <PeekFrame
      leftPanel={
        <TopicsColumnView
          topics={mine}
          read={read}
          unread={unread}
          selected={current?.id}
          exploring={place.type === 'explore'}
          onOpen={open}
          onExplore={() => setPlace({ type: 'explore' })}
          menu={menu}
        />
      }
      rightPanel={right}
    />
  )
}
