import { useCallback, useEffect, useMemo, useState } from 'react'
import { isArchived, planLookInTopic, planMoveInTopic, planPutBackInTopic, type ArrangedFile, type FileLook, type ForeignObject, type ListedFile } from '@estiva-app/interop'
import { arrangeTopicAsViewer, publishAsViewer, setTopicFileAsViewer, topicFilesAsViewer } from '@/nostr/foreign'
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

  const load = useCallback(async (): Promise<TopicFilesState | null> => {
    const v = viewer()
    if (!address || !v) return null
    try {
      const listed = await topicFilesAsViewer(address, v.relayUrl, v.token)
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
  */
  const drawnFiles = held && held.topic === address && typeof held.state === 'object' && 'files' in held.state ? held.state.files : null
  const arrange = useCallback(
    async (
      file: string,
      shown: (files: TopicFile[]) => TopicFile[],
      plan: (pubkey: string) => (files: readonly ArrangedFile[], createdAtMs: number) => ReturnType<typeof planLookInTopic> | null,
      refused: string,
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const v = viewer()
      if (!address || !folder || !v || !drawnFiles) return { ok: false, reason: 'Sign in again to change this topic.' }
      const before = drawnFiles
      setHeld({ topic: address, state: { files: shown(before) } })
      setBusy((now) => new Set(now).add(file))
      try {
        const read = async () => topicFilesAsViewer(address, v.relayUrl, v.token)
        const result = await arrangeTopicAsViewer({ files: before.map((f) => f.listed), read, plan: plan(v.token.pubkey) }, v.relayUrl, v.token)
        const after = await load()
        if (after && !(typeof after === 'object' && 'failed' in after)) take(after)
        else if (!result.ok) setHeld({ topic: address, state: { files: before } })
        if (result.ok) topicListChanged(address)
        return result.ok ? { ok: true } : { ok: false, reason: refused }
      } finally {
        setBusy((now) => {
          const next = new Set(now)
          next.delete(file)
          return next
        })
      }
    },
    [address, folder, viewer, drawnFiles, load, take],
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
        'Couldn’t change how the file shows.',
      ),
    [arrange, address, folder],
  )

  const putBack = useCallback(
    async (gone: ListedFile, after: string | null): Promise<{ ok: true } | { ok: false; reason: string }> => {
      const v = viewer()
      if (!address || !folder || !v) return { ok: false, reason: 'Sign in again to change this topic.' }
      const back = planPutBackInTopic(v.token.pubkey, Date.now(), { topic: { address, folder }, file: gone, after })
      setBusy((now) => new Set(now).add(gone.file))
      try {
        const listed = await publishAsViewer(back.relist, v.relayUrl, v.token)
        if (!listed.ok) return { ok: false, reason: 'Couldn’t put the file back.' }
        const read = async () => topicFilesAsViewer(address, v.relayUrl, v.token)
        // Back on the list, then back in its place: planned on the list as it is now, after the listing.
        const placed = await arrangeTopicAsViewer({ files: await read(), read, plan: back.move }, v.relayUrl, v.token)
        take(await load())
        topicListChanged(address)
        return placed.ok ? { ok: true } : { ok: false, reason: 'The file is back, at the end: its place couldn’t be saved.' }
      } catch {
        take(await load())
        return { ok: false, reason: 'Couldn’t put the file back.' }
      } finally {
        setBusy((now) => {
          const next = new Set(now)
          next.delete(gone.file)
          return next
        })
      }
    },
    [address, folder, viewer, load, take],
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
