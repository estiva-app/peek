import { startTransition, useEffect, useState } from 'react'
import type { ForeignObject } from '@estiva-app/interop'

/**
 * Topics started and not yet answered for (PEE-6).
 *
 * Start opens the new topic at once and writes it behind the page, so for a
 * moment Peek draws a topic the relay does not have. This is where that moment
 * is held, in this tab only: what the tree lists in its Folder, what the page
 * draws, and what a message sent into it waits for. Nothing here reaches the
 * copy on the device, which keeps only what the relay answered (Miky, PEE-6
 * kickoff), and a pending topic looks like any other.
 *
 * A refused one is announced only after every message that was waiting on it
 * has had its text put back, so the one note can say whether text came back.
 */

/** `deleted`: it was saved, and deleted when its Folder refused it — its `d` is spent. */
export type TopicOutcome = { ok: true } | { ok: false; reason: string; deleted?: true }

/** What Start opened, and what starting it again needs. */
export interface StartedTopic {
  address: string
  naddr: string
  /** Its `d`: starting it again after a refusal reuses it, so the draft under its address comes back. */
  fileId: string
  title: string
  /** The summary it was started with, if any: a refusal puts it back in Start's field with the title. */
  summary?: string
  /** The team it was written in — where the person is sent back to, and what lists it. */
  folder: string
  folderName?: string
  hasState: boolean
  /** The file it was started under, when it was: Start's dialog names it again. */
  parent?: ForeignObject
  /** The file as its Folder's listing and its page will draw it. */
  file: ForeignObject
}

/** A refused topic, once what was waiting on it has been put back. */
export interface RefusedTopic extends StartedTopic {
  reason: string
  /** It was saved and deleted again: started again, it takes a new `d`, and its draft moves with it. */
  deleted: boolean
  /** A message sent into it came back as text. */
  textBack: boolean
}

interface Pending extends StartedTopic {
  settled: Promise<TopicOutcome>
  /** Messages sent into it that have not yet said what came back. */
  waiting: number
  textBack: boolean
  /** Called when the last of them has, once the topic was refused. */
  drained?: () => void
}

/** How long a refused topic's note waits for a queued message to say what came back. */
const PUT_BACK_WAIT_MS = 3_000

const pending = new Map<string, Pending>()
/**
 * Started topics a listing of their Folder has not yet read back — pending, or
 * accepted since that listing was read — so the row is there from Start on
 * and is not dropped in between. A listing read after the topic was accepted
 * is the relay's word on it, whether or not it holds it: a topic deleted or
 * moved meanwhile is not drawn back in.
 */
const unlisted = new Map<string, { folder: string; file: ForeignObject; acceptedAt?: number }>()
const listeners = new Set<() => void>()
const refusalListeners = new Set<(refused: RefusedTopic) => void>()
let version = 0

const changed = () => {
  version += 1
  for (const listener of listeners) listener()
}

/**
 * Hold a started topic until `settled` answers. Accepted, it is let go: the
 * relay's own answers draw it from then on. Refused, it waits for what was
 * sent into it, `forget` takes back what was drawn for it, and it is
 * announced to {@link onTopicRefused}.
 */
export function holdStartedTopic(started: StartedTopic, settled: Promise<TopicOutcome>, forget: () => void = () => {}): void {
  const entry: Pending = { ...started, settled, waiting: 0, textBack: false }
  pending.set(started.address, entry)
  unlisted.set(started.address, { folder: started.folder, file: started.file })
  changed()
  void settled
    .catch((error: unknown): TopicOutcome => ({ ok: false, reason: (error as Error)?.message ?? 'The topic could not be written.' }))
    .then(async (outcome) => {
      if (!outcome.ok) {
        await putBack(entry)
        forget()
        unlisted.delete(started.address)
      } else {
        const drawn = unlisted.get(started.address)
        if (drawn) drawn.acceptedAt = Date.now()
      }
      if (pending.get(started.address) === entry) pending.delete(started.address)
      changed()
      if (outcome.ok) return
      const refused: RefusedTopic = { ...started, reason: outcome.reason, deleted: !!outcome.deleted, textBack: entry.textBack }
      for (const listener of refusalListeners) {
        try {
          listener(refused)
        } catch (error) {
          console.warn('[nostr] a refused topic’s listener failed:', error)
        }
      }
    })
}

/** Every message that was waiting has said what came back — or the wait ran out, and the note goes without it. */
function putBack(entry: Pending): Promise<void> {
  if (entry.waiting === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, PUT_BACK_WAIT_MS)
    entry.drained = () => {
      clearTimeout(timer)
      resolve()
    }
  })
}

/** What a write into this topic waits for, while it is pending; undefined once it is answered. */
export function topicSettled(address: string): Promise<TopicOutcome> | undefined {
  return pending.get(address)?.settled
}

/** The file as Start opened it, while it is pending. */
export function startedFile(address: string): ForeignObject | undefined {
  return pending.get(address)?.file
}

/** What a message sent into a topic its relay refused answers: it was not posted, and {@link topicTextBack} says what came back. */
export const TOPIC_NOT_CREATED = 'Topic not created'

/**
 * Wait for this topic before writing into it: its outcome, or undefined when it
 * is not pending. A write that waited and was refused for it is counted, and
 * the topic's note waits until each has said, through {@link topicTextBack},
 * whether its text came back.
 */
export function waitOnTopic(address: string): Promise<TopicOutcome> | undefined {
  const entry = pending.get(address)
  if (!entry) return undefined
  entry.waiting += 1
  return entry.settled.then((outcome) => {
    // Accepted: nothing to put back, and nothing for the note to wait for.
    if (outcome.ok) entry.waiting -= 1
    return outcome
  })
}

/** A message refused with its topic is back where it was written; `textBack` when it had text. */
export function topicTextBack(address: string, textBack: boolean): void {
  const entry = pending.get(address)
  if (!entry || entry.waiting === 0) return
  entry.textBack ||= textBack
  entry.waiting -= 1
  if (entry.waiting === 0) entry.drained?.()
}

/** Hear of each refused topic, once what was waiting on it is back. */
export function onTopicRefused(listener: (refused: RefusedTopic) => void): () => void {
  refusalListeners.add(listener)
  return () => refusalListeners.delete(listener)
}

/** Started topics this Folder's listing does not hold yet, as it draws them. */
export function startedFilesIn(folder: string, listed: readonly ForeignObject[]): ForeignObject[] {
  return [...unlisted.entries()]
    .filter(([address, entry]) => entry.folder === folder && !listed.some((file) => file.address === address))
    .map(([, entry]) => entry.file)
}

/**
 * A listing of this Folder was read, asked at `askedAt` (ms): what it holds no
 * longer needs drawing in, and neither does a topic accepted before it was asked.
 */
export function listedNow(folder: string, listed: readonly ForeignObject[], askedAt: number): void {
  let dropped = false
  for (const [address, entry] of unlisted) {
    if (entry.folder !== folder) continue
    const answered = listed.some((file) => file.address === address) || (entry.acceptedAt !== undefined && askedAt >= entry.acceptedAt)
    if (answered) dropped = unlisted.delete(address) || dropped
  }
  if (dropped) changed()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Changes whenever a topic is started or answered — as a transition: Start
 * announces the topic before its caller opens it, and the Folder's row is
 * not worth drawing ahead of the page that opens (4ef41d41).
 */
export function useStartedTopicsVersion(): number {
  const [seen, setSeen] = useState(version)
  useEffect(() => {
    const update = () => startTransition(() => setSeen(version))
    update()
    return subscribe(update)
  }, [])
  return seen
}

/** For tests. */
export function resetStartedTopicsForTests(): void {
  pending.clear()
  unlisted.clear()
  refusalListeners.clear()
  changed()
}
