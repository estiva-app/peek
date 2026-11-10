import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isArchived, planLookInTopic, planMoveInTopic, planPutBackInTopic, type ArrangedFile, type FileLook, type ForeignObject, type ListedFile } from '@estiva-app/interop'
import { arrangeTopicAsViewer, publishAsViewer, setTopicFileAsViewer, topicListAsViewer } from '@/nostr/foreign'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRelayViewer, useResolvedReferences } from './foreign'
import { hasRelay } from './relayUrl'
import { topicListChanged, useRearchived } from './useTopicsColumn'

/** A file a topic lists, resolved: its id and the address it was found at. */
export interface TopicFile {
  file: string
  address: string
  /** Archived, on its own or with a file above it: behind the Overview's Archived line. Absent on a read not yet resolved. */
  archived?: boolean
  /** The list's entry as read, with the file's team from its root: what a topic at All reads the files' conversations by (TOPI-3). */
  listed: ListedFile
  /** The file as resolved: its title and kind, for its heading over its threads at All. Absent while unknown. */
  object?: ForeignObject
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
  /** Move a file to just after `after` (`null`: first), drawn there at once; put back where it was if the relay refuses. */
  move: (file: string, after: string | null) => Promise<{ ok: true } | { ok: false; reason: string }>
  /** Show a file as a row or a card, drawn so at once; as it was if the relay refuses. */
  setLook: (file: string, look: FileLook) => Promise<{ ok: true } | { ok: false; reason: string }>
  /** Undo of Remove: list `gone` (the entry as read before its Remove) again, just after `after`, with its look. */
  putBack: (gone: ListedFile, after: string | null) => Promise<{ ok: true } | { ok: false; reason: string }>
} {
  const viewer = useRelayViewer()
  const address = topic ?? null
  const [held, setHeld] = useState<{ topic: string; state: TopicFilesState }>()
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  // The whole list as last read, files this viewer cannot read included: what an arrangement is planned on (TOPI-5).
  const lastRead = useRef<{ topic: string; all: readonly ListedFile[] }>(undefined)
  const load = useCallback(async (): Promise<TopicFilesState | null> => {
    const v = viewer()
    if (!address || !v) return null
    try {
      const all = await topicListAsViewer(address, v.relayUrl, v.token)
      lastRead.current = { topic: address, all }
      const listed = all.filter((entry): entry is ListedFile & { address: string } => entry.address !== null)
      return { files: listed.map((entry) => ({ file: entry.file, address: entry.address, listed: entry })) }
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

  /*
    Arranging (TOPI-5; why:
    https://github.com/estiva-app/estiva-docs/blob/main/decisions/each-file-on-a-topic-keeps-its-own-place-and-look.md):
    drawn the new way at once, then written, then the topic read back, which is the order and look the relay holds,
    another person's moves included. A refusal draws what the relay holds, or, with no answer, what was drawn before.

    One at a time: a second drop while the first is saving is drawn at once, and written once the first is read
    back, so it is planned on the keys the first wrote. Until the last one is back, a read-back draws nothing over
    the moves still waiting.
  */
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const waiting = useRef(0)
  const queued = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    waiting.current += 1
    const run = queue.current.then(work).finally(() => {
      waiting.current -= 1
    })
    queue.current = run.catch(() => undefined)
    return run
  }, [])
  // The read-back: drawn when nothing else waits; `failed` draws what `fallback` gives, if anything.
  const readBack = useCallback(
    async (fallback?: () => void) => {
      const after = await load()
      if (waiting.current > 1) return
      if (after && !(typeof after === 'object' && 'failed' in after)) take(after)
      else fallback?.()
    },
    [load, take],
  )
  const done = useCallback((file: string) => {
    setBusy((now) => {
      const next = new Set(now)
      next.delete(file)
      return next
    })
  }, [])

  const drawnFiles = held && held.topic === address && typeof held.state === 'object' && 'files' in held.state ? held.state.files : null
  const arrange = useCallback(
    async (
      file: string,
      shown: (files: TopicFile[]) => TopicFile[],
      plan: (pubkey: string) => (files: readonly ArrangedFile[], createdAtMs: number) => ReturnType<typeof planLookInTopic> | null,
      refused: string,
      changesTheList: boolean,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const v = viewer()
      if (!address || !folder || !v || !drawnFiles) return { ok: false, reason: 'Sign in again to change this topic.' }
      const before = drawnFiles
      setHeld({ topic: address, state: { files: shown(before) } })
      setBusy((now) => new Set(now).add(file))
      return queued(async () => {
        try {
          const read = async () => topicListAsViewer(address, v.relayUrl, v.token)
          const files = lastRead.current?.topic === address ? lastRead.current.all : await read()
          const result = await arrangeTopicAsViewer({ files, read, plan: plan(v.token.pubkey) }, v.relayUrl, v.token)
          await readBack(result.ok ? undefined : () => setHeld({ topic: address, state: { files: before } }))
          // The Topics column draws the list's files, not their looks.
          if (result.ok && changesTheList) topicListChanged(address)
          return result.ok ? ({ ok: true } as const) : ({ ok: false, reason: refused } as const)
        } catch {
          await readBack(() => setHeld({ topic: address, state: { files: before } }))
          return { ok: false, reason: refused } as const
        } finally {
          done(file)
        }
      })
    },
    [address, folder, viewer, drawnFiles, queued, readBack, done],
  )

  const move = useCallback(
    (file: string, after: string | null) =>
      arrange(
        file,
        (files) => {
          const moved = files.find((f) => f.file === file)
          if (!moved) return files
          const rest = files.filter((f) => f.file !== file)
          rest.splice(after === null ? 0 : rest.findIndex((f) => f.file === after) + 1, 0, moved)
          return rest
        },
        (pubkey) => (files, ms) => {
          // Planned again on a read after a conflict: a file gone since has nothing left to move.
          if (!files.some((f) => f.file === file) || (after !== null && !files.some((f) => f.file === after))) return null
          return planMoveInTopic(pubkey, ms, { topic: { address: address!, folder: folder! }, files, file, after })
        },
        'Couldn’t move the file. It’s back where it was.',
        true,
      ),
    [arrange, address, folder],
  )

  const setLook = useCallback(
    (file: string, look: FileLook) =>
      arrange(
        file,
        (files) => files.map((f) => (f.file === file ? { ...f, listed: { ...f.listed, look } } : f)),
        (pubkey) => (files, ms) => {
          const now = files.find((f) => f.file === file)
          return now && now.look !== look ? planLookInTopic(pubkey, ms, { topic: { address: address!, folder: folder! }, file: now, look }) : null
        },
        `Couldn’t show it as a ${look}. It’s back as it was.`,
        false,
      ),
    [arrange, address, folder],
  )

  const putBack = useCallback(
    async (gone: ListedFile, after: string | null): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const v = viewer()
      if (!address || !folder || !v) return { ok: false, reason: 'Sign in again to change this topic.' }
      setBusy((now) => new Set(now).add(gone.file))
      return queued(async () => {
        const back = planPutBackInTopic(v.token.pubkey, Date.now(), { topic: { address, folder }, file: gone, after })
        // Back on the list, with no answer to read it by: drawn at the end, where the relay now has it.
        const atTheEnd = () =>
          setHeld((now) =>
            now?.topic === address && typeof now.state === 'object' && 'files' in now.state && gone.address && !now.state.files.some((f) => f.file === gone.file)
              ? { topic: address, state: { files: [...now.state.files, { file: gone.file, address: gone.address, listed: gone }] } }
              : now,
          )
        let listed = false
        try {
          listed = (await publishAsViewer(back.relist, v.relayUrl, v.token)).ok
          if (!listed) return { ok: false, reason: 'Couldn’t put the file back.' } as const
          topicListChanged(address)
          const read = async () => topicListAsViewer(address, v.relayUrl, v.token)
          // Then back in its place: planned on the list as it is now, after the listing.
          const placed = await arrangeTopicAsViewer({ files: await read(), read, plan: back.move }, v.relayUrl, v.token)
          await readBack(atTheEnd)
          return placed.ok ? ({ ok: true } as const) : ({ ok: false, reason: 'The file is back, at the end: its place couldn’t be saved.' } as const)
        } catch {
          await readBack(listed ? atTheEnd : undefined)
          return { ok: false, reason: listed ? 'The file is back, at the end: its place couldn’t be saved.' : 'Couldn’t put the file back.' } as const
        } finally {
          done(gone.file)
        }
      })
    },
    [address, folder, viewer, queued, readBack, done],
  )

  /*
    Which are archived, on their own or with a file above them (TOPI-10; why:
    https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md):
    they wait behind the Overview's Archived line. An Archive or Unarchive in
    this tab is drawn over the held answer at once.
  */
  const read = held && held.topic === address ? held.state : 'loading'
  const listed = typeof read === 'object' && 'files' in read ? read.files.map((file) => file.address) : []
  const objects = useResolvedReferences(listed, ARCHIVED_WITH)
  const rearchived = useRearchived()
  const state = useMemo<TopicFilesState>(() => {
    if (typeof read !== 'object' || !('files' in read)) return read
    // Until each is known, nothing is drawn: a file never jumps from the list to the Archived line.
    if (read.files.some((file) => !(file.address in objects) && !rearchived.has(file.address))) return 'loading'
    return {
      files: read.files.map((file) => {
        const object = rearchived.has(file.address) ? rearchived.get(file.address) : objects[file.address]
        return { ...file, archived: !!object && isArchived(object), ...(object ? { object } : {}) }
      }),
    }
  }, [read, objects, rearchived])
  return { state, busy, setListed, move, setLook, putBack }
}

const ARCHIVED_WITH = { archivedWith: true }
