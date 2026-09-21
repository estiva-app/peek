/**
 * Foreign-object reads and actions, through the seam.
 *
 * These used to be `useAction(api.nostr.foreign.…)` calls made straight from
 * two components, which reached past `@/api` and also handed the viewer's
 * bearer token to a Convex action. Both are fixed here: the relay work happens
 * in the browser (PEEK-106), and components ask `@/api` for it like everything
 * else.
 *
 * Every function resolves to `null` — or a readable reason — rather than
 * throwing. A reference that cannot be resolved must degrade to plain text; a
 * message is never broken because an attachment failed.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { validToken } from '@/auth/estivaId'
import { avatarFor, PEOPLE as MOCK_PEOPLE } from '@/data/peopleData'
import { hasConvex } from './store'
import {
  applyActionAsViewer,
  fileAddressAsViewer,
  fileFolderAsViewer,
  routeWordsAsViewer,
  commentedFileOf,
  creatableUnderAsViewer,
  placeForReferenceAsViewer,
  type ReferencePlace,
  directoryAsViewer,
  conversationsAsViewer,
  channelStreamsAsViewer,
  createFolderAsViewer,
  createTopicAsViewer,
  deleteFileAsViewer,
  deleteFolderAsViewer,
  moveFileAsViewer,
  renameFileAsViewer,
  renameFolderAsViewer,
  resolveFolderContentsAsViewer,
  listFoldersAsViewer,
  resolveFolderProjectAsViewer,
  resolveObjectAsViewer,
  searchMessagesAsViewer,
  threadsAsViewer,
  replyToCommentAsViewer,
  type ActResult,
  type FileComment,
  type FileThreads,
} from '@/nostr/foreign'
import { RelayReadError } from '@/nostr/relayRead'
import { rootOf, type StreamMessage } from '@/nostr/channelStreams'
import type { MessageSearchState } from '@/lib/launcherSearch'
import { currentRouteWords, subscribeRouteWords, type RouteWords } from '@/lib/objectUrl'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import type {
  ConversationMessage,
  FolderContents,
  FolderProject,
  FolderSummary,
  ForeignObject,
  People,
} from '@estiva-app/interop'

/**
 * The relay origin and the viewer's token, or null when either is missing.
 *
 * Both are required and neither is optional-with-a-fallback: without a token
 * the relay answers `403 relay_membership_required`, and without an origin
 * there is nowhere to ask. Returning null lets each caller degrade in the way
 * that suits it rather than guessing here.
 */
export function useRelayViewer() {
  const config = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')
  return useCallback(() => {
    const relayUrl = config?.relayUrl
    const token = validToken()
    return relayUrl && token ? { relayUrl, token } : null
  }, [config?.relayUrl])
}

/**
 * The route words the manifests declare (FOL-39), and the one read that fills
 * them in.
 *
 * `filePath` reads the registry in render, so it cannot wait; this asks the
 * relay once per session from the app's root and subscribes to the registry,
 * so links drawn before the manifests answered are drawn again with the words
 * once they have. Until then, and signed out, the registry holds Peek's own
 * shape alone and every other kind links in its long form, which opens the
 * same page. A failed read is left to the next reader of the shapes — a
 * pasted URL or a short link — which retries it.
 */
export function useRouteWords(): RouteWords {
  const viewer = useRelayViewer()
  useEffect(() => {
    const v = viewer()
    if (!v) return
    routeWordsAsViewer(v.relayUrl, v.token).catch(() => {})
  }, [viewer])
  return useSyncExternalStore(subscribeRouteWords, currentRouteWords, currentRouteWords)
}

export function useForeignObjects() {
  const viewer = useRelayViewer()

  const resolveObject = useCallback(
    async (naddr: string): Promise<ForeignObject | null> => {
      const v = viewer()
      return v ? resolveObjectAsViewer(naddr, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  /**
   * The address behind a `/<word>/<slug>-<d>` link (FOL-37, FOL-39), or null
   * when no file of the word's kinds carries the `d` — and null signed out,
   * which the page renders as the same dead link a signed-out viewer gets
   * from `resolveObject`.
   */
  const resolveFileAddress = useCallback(
    async (word: string, identifier: string): Promise<string | null> => {
      const v = viewer()
      return v ? fileAddressAsViewer(word, identifier, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  /**
   * The Folder a file with no `h` writes its conversation in (PEE-33), or
   * null when the record names none — and null signed out, like the rest.
   */
  const resolveFileFolder = useCallback(
    async (address: string): Promise<string | null> => {
      const v = viewer()
      return v ? fileFolderAsViewer(address, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  const resolveFolderProject = useCallback(
    async (folder: string): Promise<FolderProject | null> => {
      const v = viewer()
      return v ? resolveFolderProjectAsViewer(folder, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  /**
   * Everything in a Folder — the navigation read, beside the sidebar's.
   *
   * Signed out this is an empty Folder rather than `null`: navigation renders
   * either way, and a signed-out viewer genuinely holds no files, which is the
   * same sentence as a Folder whose contents they may not read (RFC 0.4 §4.2 —
   * the count is the disclosure, so the two must not be distinguishable).
   */
  /**
   * What each of a set of already-resolved files' conversations holds.
   *
   * `{}` signed out rather than null: a folder listing renders either way, and
   * "no badge" is the honest rendering of "we did not ask". A caller must not
   * read a missing entry as an empty conversation — see `useConversationBadges`.
   */
  const conversations = useCallback(
    async (files: ForeignObject[]): Promise<Record<string, ConversationMessage[]>> => {
      const v = viewer()
      return v ? conversationsAsViewer(files, v.relayUrl, v.token) : {}
    },
    [viewer],
  )

  /**
   * Every stream of every Folder listed — the read behind a team's dot
   * (FOL-18). `{}` signed out, on the same terms as `conversations`: a Folder
   * absent from the answer was not asked about, which is not "nothing new".
   */
  const channelStreams = useCallback(
    async (folderIds: readonly string[]): Promise<Record<string, StreamMessage[]>> => {
      const v = viewer()
      return v ? channelStreamsAsViewer(folderIds, v.relayUrl, v.token) : {}
    },
    [viewer],
  )

  const resolveFolderContents = useCallback(
    async (folder: string): Promise<FolderContents> => {
      const v = viewer()
      return v
        ? resolveFolderContentsAsViewer(folder, v.relayUrl, v.token)
        : { id: folder, hasState: false, source: 'channel', files: [] }
    },
    [viewer],
  )

  /**
   * Every Folder this viewer can see, for the navigation.
   *
   * `null` when signed out, **not** an empty array. The two are different
   * sentences — "there are no folders" and "you are not signed in" — and
   * collapsing them is what made the folder list say "No folders yet" to a
   * signed-out viewer looking at a workspace with eighty-one of them.
   */
  const listFolders = useCallback(async (): Promise<FolderSummary[] | null> => {
    const v = viewer()
    return v ? listFoldersAsViewer(v.relayUrl, v.token) : null
  }, [viewer])

  /**
   * Rename a Folder.
   *
   * `hasState` is passed through rather than looked up because the caller has
   * just read it and a wrong guess is silent data loss — see
   * {@link renameFolderAsViewer}.
   */
  const renameFolder = useCallback(
    async (folder: string, name: string, hasState: boolean) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to rename a folder.' }
      return renameFolderAsViewer(folder, name, hasState, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** Delete a Folder. The files in it are unfiled, not deleted. */
  const deleteFolder = useCallback(
    async (folder: string) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to delete a folder.' }
      return deleteFolderAsViewer(folder, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** Move a file between Folders — adds to the target first. */
  const moveFile = useCallback(
    async (address: string, from: string, to: string) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to move a file.' }
      return moveFileAsViewer(address, from, to, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Start a topic in a Folder — a bare file, SPEC §6.7. `parent` is the
   * address of the file it sits under, of any kind. `hasState` comes from the
   * Folder read on the page, never from a guess; see `createTopicAsViewer`.
   */
  const createTopic = useCallback(
    async (args: { folder: string; title: string; parent?: string; hasState: boolean }) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to start a topic.' }
      return createTopicAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Rename a file through its manifest's `rename` action (FOL-33). Offered by
   * a page only when the resolved file's `actions` declare one; refused here
   * with the runtime's sentence when they do not.
   */
  const renameFile = useCallback(
    async (args: { naddr: string; actionId: string; title: string }) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to rename a topic.' }
      return renameFileAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Delete a file through its manifest's `delete` action, then unlist it from
   * a Folder that has state (FOL-33). `hasState` comes from the Folder read on
   * the page, never from a guess; see `deleteFileAsViewer`.
   */
  const deleteFile = useCallback(
    async (args: { naddr: string; actionId: string; address: string; folder: string; hasState: boolean }) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to delete a topic.' }
      return deleteFileAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** Create a Folder. Refuses rather than pretending when signed out. */
  const createFolder = useCallback(
    async (name: string) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to create a folder.' }
      return createFolderAsViewer(name, v.relayUrl, v.token)
    },
    [viewer],
  )

  const applyAction = useCallback(
    async (args: {
      naddr: string
      actionId: string
      /** `{ property: value }` for an object-creating action (PRO-4). */
      value: string | Record<string, string>
    }): Promise<ActResult & { created?: string }> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to change another app’s object.' }
      return applyActionAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * What is under each of a file's comments — the thread panel's read (FOL-19).
   *
   * Signed out this is an empty answer rather than a throw, on the same terms
   * as the rest of this seam: the panes render, and a viewer who is not signed
   * in genuinely has no replies to see.
   */
  const threads = useCallback(
    async (reference: string, rootIds: readonly string[]): Promise<FileThreads> => {
      const v = viewer()
      return v ? threadsAsViewer(reference, rootIds, v.relayUrl, v.token) : { roots: {}, replies: {} }
    },
    [viewer],
  )

  /** Reply to a comment on a file — see `replyToCommentAsViewer`. */
  const replyToComment = useCallback(
    async (args: { reference: string; parent: FileComment; body: string }): Promise<ActResult> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to reply.' }
      return replyToCommentAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** See `creatableUnderAsViewer`. Null when signed out, as everything here is. */
  const creatableUnder = useCallback(
    async (parentKind: number) => {
      const v = viewer()
      return v ? creatableUnderAsViewer(parentKind, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  /** Where in Peek a `nostr:` reference opens — see `placeForReferenceAsViewer`. */
  const placeForReference = useCallback(
    async (reference: string): Promise<ReferencePlace | null> => {
      const v = viewer()
      return v ? placeForReferenceAsViewer(reference, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  return {
    resolveObject,
    resolveFileAddress,
    resolveFileFolder,
    resolveFolderProject,
    resolveFolderContents,
    conversations,
    channelStreams,
    listFolders,
    createFolder,
    createTopic,
    renameFile,
    deleteFile,
    renameFolder,
    deleteFolder,
    moveFile,
    applyAction,
    threads,
    replyToComment,
    creatableUnder,
    placeForReference,
  }
}

/**
 * A body's references, resolved once for the whole body — RIC-10.
 *
 * The widget below a message resolves itself, one round trip per widget, and
 * that was fine while a reference had exactly one place to appear. It now has
 * two: a pointer written mid-sentence is drawn in place. Letting each of them
 * ask separately would mean two fetches for one object and — worse — the same
 * object drawn in two different states on one screen, which is the failure
 * `dedupeReferences` exists to prevent one layer up.
 *
 * So the body resolves its references and hands the answers down. `undefined`
 * for a reference not yet answered, `null` for one that resolved to nothing:
 * §13.1 draws both as the shortened URI, but they are different facts and this
 * hook does not flatten them — that flattening is what PEE-10 fixed further
 * down, where "empty" and "you may not read this" had become the same screen.
 *
 * Nothing is asked for at all without a relay and a token (`hasConvex`, the
 * viewer), so tests, Storybook and no-backend checkouts settle immediately on
 * "resolved to nothing" rather than hanging on a request that cannot be made.
 */
export function useResolvedReferences(
  references: readonly string[],
): Record<string, ForeignObject | null> {
  const { resolveObject } = useForeignObjects()
  const [objects, setObjects] = useState<Record<string, ForeignObject | null>>({})
  // The identity of the array changes on every render; the list of references
  // in a message does not. Keying the effect on the contents rather than the
  // array is what stops it re-resolving for ever.
  const key = references.join('\u0000')

  useEffect(() => {
    if (!hasConvex) return
    const refs = key ? key.split('\u0000') : []
    if (!refs.length) return
    let cancelled = false
    Promise.all(
      refs.map((ref) =>
        resolveObject(ref)
          .catch(() => null)
          .then((object) => [ref, object] as const),
      ),
      // One setState for the whole body rather than one per reference: a
      // message with four mentions should not lay out four times.
    ).then((entries) => !cancelled && setObjects(Object.fromEntries(entries)))
    return () => {
      cancelled = true
    }
  }, [key, resolveObject])

  /*
    Demo mode is derived, not set. There is no relay to ask without a
    deployment, so every reference has resolved to nothing before the first
    render — and writing that into state from the effect body is a cascading
    render for an answer that was never in doubt. `useWorkspaceDirectory` below
    keeps setState out of its effect for the same reason.
  */
  if (!hasConvex) {
    return Object.fromEntries((key ? key.split('\u0000') : []).map((ref) => [ref, null]))
  }
  return objects
}

/**
 * The demo dataset as a People map. Pseudo-keys, clearly marked: demo mode has
 * no relay and no pubkeys, and an action applied against one of these fails at
 * the sign-in gate long before the value could matter.
 */
const DEMO_DIRECTORY: People = Object.fromEntries(
  MOCK_PEOPLE.map((person) => [
    `demo:${person.id}`,
    { displayName: person.name, picture: avatarFor(person.name) },
  ]),
)

/** One fetch per minute, shared by every picker on screen. */
let directoryCache: { at: number; people: People } | null = null

/**
 * Everyone with a published profile — the assignee picker's list (PEE-1).
 *
 * `undefined` while loading; demo mode answers immediately from the mock
 * dataset so Storybook and no-backend checkouts render a working picker.
 */
export function useWorkspaceDirectory(): People | undefined {
  const viewer = useRelayViewer()
  const [people, setPeople] = useState<People | undefined>(() =>
    hasConvex ? directoryCache?.people : DEMO_DIRECTORY,
  )

  useEffect(() => {
    if (!hasConvex || people !== undefined) return
    let cancelled = false
    const cached = directoryCache
    // A fresh shared cache is adopted asynchronously — setState stays out of
    // the effect body — and the fetch is skipped for a minute across every
    // picker on screen.
    const source =
      cached && Date.now() - cached.at < 60_000
        ? Promise.resolve(cached.people)
        : (() => {
            const v = viewer()
            if (!v) return null
            return directoryAsViewer(v.relayUrl, v.token).then((result) => {
              directoryCache = { at: Date.now(), people: result }
              return result
            })
          })()
    // A failed read leaves the picker with Unassigned plus whoever the
    // object itself names — degraded, never broken.
    source?.then((result) => !cancelled && setPeople(result)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [viewer, people])

  return people
}

/** One search result, flattened to what a launcher row needs. */
export interface MessageHit {
  id: string
  /** The message body. Trimmed for display by the caller, not here. */
  content: string
  /** Author pubkey — resolved to a name by the caller's directory. */
  pubkey: string
  createdAt: number
  /** The Folder (NIP-29 channel uuid) the message was posted in, if it names one. */
  folder?: string
  /**
   * The message that opened its thread, when this one is a reply — so a result
   * can open that conversation and land on the reply (R13, UIG-29).
   */
  root?: string
  /**
   * The file this is a comment on, as an address, when the hit is a `kind:1111`
   * (FOL-36) — what decides that the result opens the file's page rather than
   * a topic. A `kind:9` has none.
   */
  file?: string
  /**
   * The file's title, resolved off its owner's manifest so the row can say
   * where the comment is. Absent when the resolve failed; the row still opens.
   */
  fileTitle?: string
}

/** How many distinct files a search answer resolves titles for — the rows the launcher draws, and no more. */
const FILE_TITLES_PER_SEARCH = 5

/**
 * The events as hits, the file comments among them named by their file.
 *
 * A comment says which file it is on but not what the file is called, and a
 * row reading "a comment · somewhere" is not a result anybody can pick. The
 * title comes off the owner's projection, one resolve per distinct file and
 * capped at what the launcher shows, in parallel — a failed resolve loses the
 * title, never the hit.
 */
async function hitsOf(events: SignedEvent[], relayUrl: string, token: StoredToken): Promise<MessageHit[]> {
  const hits: MessageHit[] = events.map((e) => {
    const file = e.kind === KIND.COMMENT ? commentedFileOf(e) : null
    return {
      id: e.id,
      content: e.content,
      pubkey: e.pubkey,
      createdAt: e.created_at,
      folder: e.tags.find((t) => t[0] === 'h')?.[1],
      ...(rootOf(e) !== e.id ? { root: rootOf(e) } : {}),
      ...(file ? { file } : {}),
    }
  })
  const files = [...new Set(hits.flatMap((h) => (h.file ? [h.file] : [])))].slice(0, FILE_TITLES_PER_SEARCH)
  if (files.length === 0) return hits
  const titles = new Map<string, string>()
  await Promise.all(
    files.map((address) =>
      resolveObjectAsViewer(address, relayUrl, token)
        .then((object) => {
          const title = object?.slots?.title?.value
          if (title) titles.set(address, title)
        })
        .catch(() => {}),
    ),
  )
  return hits.map((h) => (h.file && titles.has(h.file) ? { ...h, fileTitle: titles.get(h.file) } : h))
}

/**
 * Search message content over NIP-50 (PEE-4).
 *
 * Debounced, because the relay is a round trip and a launcher fires on every
 * keystroke. 250 ms is short enough to feel live and long enough that typing a
 * word is one request rather than six.
 *
 * **The state is the point, not just the results.** PEE-4's done-when requires
 * the empty state to tell "nothing matched" from "nothing you can read", so a
 * failure is reported with its `RelayReadError` classification rather than
 * flattened to an empty list — that flattening is the exact defect PEE-10
 * fixed one layer down, and re-introducing it here would undo it.
 */
export function useMessageSearch(query: string): { state: MessageSearchState; hits: MessageHit[] } {
  const viewer = useRelayViewer()
  /*
    Only the ANSWER is state, and it carries the term it answered. Everything
    else — idle, signed-out, searching — is derived below, so no `setState`
    runs in the effect body. `useWorkspaceDirectory` above keeps the same rule
    for the same reason, and deriving `searching` from "the answer on hand is
    for an older term" also resets it on every keystroke for free.
  */
  const [answer, setAnswer] = useState<{
    term: string
    state: MessageSearchState
    hits: MessageHit[]
  } | null>(null)
  const term = query.trim()

  useEffect(() => {
    // Nothing to ask, or nowhere to ask it: both are derived states, not
    // fetches. Demo mode has no relay at all.
    if (!term || !hasConvex) return
    let cancelled = false
    // Debounced: the relay is a round trip and a launcher fires on every
    // keystroke. 250 ms is short enough to feel live and long enough that
    // typing a word is one request rather than six.
    const timer = setTimeout(() => {
      const v = viewer()
      if (!v) {
        if (!cancelled) setAnswer({ term, state: { kind: 'signed-out' }, hits: [] })
        return
      }
      searchMessagesAsViewer(term, v.relayUrl, v.token)
        .then((events: SignedEvent[]) => hitsOf(events, v.relayUrl, v.token))
        .then((hits) => {
          if (cancelled) return
          setAnswer({ term, state: { kind: 'done', count: hits.length }, hits })
        })
        .catch((error: unknown) => {
          if (cancelled) return
          /*
            The classification survives to the UI, which is the whole ticket:
            PEE-4's empty state has to tell "nothing matched" from "nothing you
            can read", and flattening a failure to an empty list is the exact
            defect PEE-10 fixed one layer down.
          */
          setAnswer({
            term,
            state: { kind: 'failed', failure: error instanceof RelayReadError ? error.kind : 'unreachable' },
            hits: [],
          })
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, viewer])

  const fresh = answer?.term === term ? answer : null
  const state: MessageSearchState = !term
    ? { kind: 'idle' }
    : // "No messages matched" would be a claim about a corpus nobody searched.
      !hasConvex
      ? { kind: 'signed-out' }
      : (fresh?.state ?? { kind: 'searching' })

  return { state, hits: fresh?.hits ?? [] }
}
