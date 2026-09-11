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
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { validToken } from '@/auth/estivaId'
import { avatarFor, PEOPLE as MOCK_PEOPLE } from '@/data/peopleData'
import { hasConvex } from './store'
import {
  applyActionAsViewer,
  creatableUnderAsViewer,
  folderForReferenceAsViewer,
  directoryAsViewer,
  conversationCountsAsViewer,
  createFolderAsViewer,
  deleteFolderAsViewer,
  moveFileAsViewer,
  renameFolderAsViewer,
  resolveFolderContentsAsViewer,
  listFoldersAsViewer,
  resolveFolderProjectAsViewer,
  resolveObjectAsViewer,
  searchMessagesAsViewer,
  type ActResult,
} from '@/nostr/foreign'
import { RelayReadError } from '@/nostr/relayRead'
import type { MessageSearchState } from '@/lib/launcherSearch'
import type { SignedEvent } from '@estiva-app/protocol'
import type { FolderContents, FolderProject, FolderSummary, ForeignObject, People } from '@estiva-app/interop'

/**
 * The relay origin and the viewer's token, or null when either is missing.
 *
 * Both are required and neither is optional-with-a-fallback: without a token
 * the relay answers `403 relay_membership_required`, and without an origin
 * there is nowhere to ask. Returning null lets each caller degrade in the way
 * that suits it rather than guessing here.
 */
function useRelayViewer() {
  const config = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')
  return useCallback(() => {
    const relayUrl = config?.relayUrl
    const token = validToken()
    return relayUrl && token ? { relayUrl, token } : null
  }, [config?.relayUrl])
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
   * Message counts for a set of already-resolved files.
   *
   * `{}` signed out rather than null: a folder listing renders either way, and
   * "no badge" is the honest rendering of "we did not ask". A caller must not
   * read a missing entry as a zero — see `useConversationCounts`.
   */
  const conversationCounts = useCallback(
    async (files: ForeignObject[]): Promise<Record<string, number>> => {
      const v = viewer()
      return v ? conversationCountsAsViewer(files, v.relayUrl, v.token) : {}
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

  /** See `creatableUnderAsViewer`. Null when signed out, as everything here is. */
  const creatableUnder = useCallback(
    async (parentKind: number) => {
      const v = viewer()
      return v ? creatableUnderAsViewer(parentKind, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  /** The Folder a `nostr:` reference points into — see `folderForReferenceAsViewer`. */
  const folderForReference = useCallback(
    async (reference: string) => {
      const v = viewer()
      return v ? folderForReferenceAsViewer(reference, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  return {
    resolveObject,
    resolveFolderProject,
    resolveFolderContents,
    conversationCounts,
    listFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFile,
    applyAction,
    creatableUnder,
    folderForReference,
  }
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
        .then((events: SignedEvent[]) => {
          if (cancelled) return
          setAnswer({
            term,
            state: { kind: 'done', count: events.length },
            hits: events.map((e) => ({
              id: e.id,
              content: e.content,
              pubkey: e.pubkey,
              createdAt: e.created_at,
              folder: e.tags.find((t) => t[0] === 'h')?.[1],
            })),
          })
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
