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
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { validToken } from '@/auth/estivaId'
import { heldToken } from '@/auth/heldSession'
import { avatarFor, PEOPLE as MOCK_PEOPLE } from '@/data/peopleData'
import { RELAY_URL, hasRelay } from './relayUrl'
import {
  applyActionAsViewer,
  cardActionAsViewer,
  archiveFileAsViewer,
  archiveFolderAsViewer,
  archiveImpactAsViewer,
  fileAddressAsViewer,
  routeWordsAsViewer,
  commentedFileOf,
  creatableUnderAsViewer,
  placeForReferenceAsViewer,
  dmForChannelAsViewer,
  type DmChannel,
  type ReferencePlace,
  directoryAsViewer,
  conversationsAsViewer,
  createFolderAsViewer,
  deleteFileAsViewer,
  deleteFolderAsViewer,
  folderDeletableAsViewer,
  moveFileAsViewer,
  renameFileAsViewer,
  renameFolderAsViewer,
  resolveFolderContentsAsViewer,
  listFoldersAsViewer,
  folderLoadAsViewer,
  resolveFolderProjectAsViewer,
  linkReaderAsViewer,
  resolveObjectAsViewer,
  resolveObjectFromCopy,
  resolveObjectsAsViewer,
  searchMessagesAsViewer,
  searchFileReferencesAsViewer,
  threadsAsViewer,
  replyToCommentAsViewer,
  type ActResult,
  type FileComment,
  type FileThreads,
} from '@/nostr/foreign'
import { relayFailureKind } from '@/nostr/relayRead'
export { isFromCopy } from '@/nostr/foreign'
import type { ReadSource } from '@/nostr/readFrom'
import { commentAsViewer, fileThreadsAsViewer } from '@/nostr/fileConversation'
import { rootOf } from '@/nostr/channelStreams'
import type { MessageSearchState } from '@/lib/launcherSearch'
import { linkTargetOf, rankReferences, type ReferenceCandidate } from '@estiva-app/conversation'
import { KIND_BARE_FILE, type LinkReader } from '@estiva-app/interop'
import { currentRouteWords, subscribeRouteWords, type RouteWords } from '@/lib/objectUrl'
import { KIND, type SignedEvent } from '@estiva-app/protocol'
import type { StoredToken } from '@/auth/estivaId'
import { createListingCache, type ListingLoad } from '@/platform/listingCache'
import { useListing } from '@/platform/useListing'
import { joinFolderWatch } from '@/nostr/useLiveFile'
import { startTopicAsViewer, type StartTopicArgs } from './startTopic'
import type {
  ArchiveImpact,
  ArchiveReadOptions,
  ConversationMessage,
  FolderContents,
  FolderProject,
  FolderRef,
  MovableFile,
  FolderSummary,
  ForeignObject,
  People,
  QueryFn,
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
  return useCallback(() => {
    const relayUrl = RELAY_URL
    const token = heldToken()
    return relayUrl && token ? { relayUrl, token } : null
  }, [])
}

/**
 * One load of Folder reads, as the viewer (APP-2; `folderLoadAsViewer`): pass
 * it to `listFolders` and each `resolveFolderContents` read together, and drop
 * it after. `undefined` when signed out, which those reads answer for themselves.
 */
export function folderLoad(): QueryFn | undefined {
  const token = heldToken()
  return RELAY_URL && token ? folderLoadAsViewer(RELAY_URL, token) : undefined
}

/*
  What an app link names (SPEC §7.7, §13.6): the viewer's one link reader
  (`linkReaderAsViewer`, interop's `linkReader`, PEEKM-7), which every box,
  message and card here asks. A link is asked once for the reader's life; a
  read that failed is forgotten and said as a change later, so whoever still
  draws from it asks again. What is heard here outlives a change of viewer:
  the new reader's answers are told to the same listeners.
*/
let watched: { reader: LinkReader; stop: () => void } | null = null
const linkListeners = new Set<() => void>()
let linkVersion = 0
const linksHeard = () => {
  linkVersion += 1
  for (const listener of linkListeners) listener()
}

function readerFor(token: StoredToken | null): LinkReader | null {
  if (!RELAY_URL || !token) return null
  const reader = linkReaderAsViewer(RELAY_URL, token)
  if (watched?.reader !== reader) {
    watched?.stop()
    watched = { reader, stop: reader.changed(linksHeard) }
    // Another viewer: nothing the last one was told holds, nor what it was refused.
    resting.clear()
    linkVersion += 1
  }
  return reader
}

/** Called each time a link's answer comes back, or a failed one may be asked again. Returns the unsubscribe. */
export function onLinksChanged(listener: () => void): () => void {
  linkListeners.add(listener)
  return () => {
    linkListeners.delete(listener)
  }
}

/** A snapshot of {@link onLinksChanged}, for `useSyncExternalStore`. */
export const linksVersion = (): number => linkVersion

/** What an app link names, from what has come back: undefined until it has, and for nothing. A `LinkResolver`. */
export function knownCardValue(url: string): string | undefined {
  return readerFor(heldToken())?.known(url)
}

/** What a link to one block names, from what has come back: undefined until it has, and for any other link. */
export function knownBlockOfUrl(url: string): { address: string; block: string } | undefined {
  return readerFor(heldToken())?.knownBlock(url)
}

/**
 * Ask what each of these links names: the file for a card, the block for a
 * part. A `LinkChips` `ask`; settles when every answer is in, and rejects when
 * a read failed (the relay or the token), so the editor asks again later.
 */
export async function askLinks(urls: readonly string[]): Promise<void> {
  const reader = readerFor(validToken())
  if (!reader) return
  const wanted = [...new Set(urls)]
  const now = Date.now()
  const due = wanted.filter((url) => (resting.get(url)?.until ?? 0) <= now)
  const settled = await Promise.allSettled(due.map((url) => answerAfterRest(reader, url)))
  if (due.length < wanted.length || settled.some((result) => result.status === 'rejected')) {
    throw new Error('A link could not be asked about; asked again later.')
  }
}

/*
  A link whose read failed rests before it is asked again: 5, 10, then 20 s,
  then a minute, however often something asks for it. Every answer redraws
  every message that draws links, and a box asks on each keystroke, so without
  the rest one refused read (a 429) would be asked again by every message on
  every other link's answer: 24 links came to about 1.7K `#d` queries in 35 s
  (PEEKM-7's review). The rest over, the messages are told, and ask. The reader
  itself is made with no retries of its own (`linkReaderAsViewer`), so this is
  the one schedule.
*/
const LINK_REST_MS = 5000
const LINK_REST_MAX_MS = 60_000
const LINK_RETRIES_TOLD = 3
const resting = new Map<string, { failures: number; until: number }>()
const failuresCounted = new WeakSet<Promise<unknown>>()

function answerAfterRest(reader: LinkReader, url: string): Promise<void> {
  const pending = reader.answerOf(url)
  return pending.then(
    () => {
      resting.delete(url)
    },
    (error: unknown) => {
      // Two asks of one read in flight share its failure: it counts once.
      if (!failuresCounted.has(pending)) {
        failuresCounted.add(pending)
        const failures = (resting.get(url)?.failures ?? 0) + 1
        const wait = Math.min(LINK_REST_MS * 2 ** (failures - 1), LINK_REST_MAX_MS)
        resting.set(url, { failures, until: Date.now() + wait })
        if (failures <= LINK_RETRIES_TOLD) setTimeout(linksHeard, wait)
      }
      throw error
    },
  )
}

/** What an app link in the message box draws as, from what has come back (`linkTargetOf`). A `LinkResolver`. */
export function knownLinkTarget(url: string): string | undefined {
  return linkTargetOf(url, { resolveLink: knownCardValue, blockOf: knownBlockOfUrl })
}

/**
 * What each of these app links names, for a reader's `cardsIn` (SPEC §13.6.2):
 * a `LinkResolver` that answers from what has come back, and is replaced as
 * more does, so the message draws again. A link not answered yet names nothing.
 */
export function useLinkResolver(urls: readonly string[]): (url: string) => string | undefined {
  const key = urls.join('\n')
  const version = useSyncExternalStore(onLinksChanged, linksVersion)
  useEffect(() => {
    // Asked again on a change: a read that failed may be asked again, and a known link costs nothing.
    if (key) askLinks(key.split('\n')).catch(() => {})
  }, [key, version])
  return (url: string) => knownCardValue(url)
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

/**
 * How long a message's widget is drawn from what this tab resolved before it
 * is asked again on mount (OPT-3). A widget never updated while it stayed on
 * screen; held, it does not update while you are away either, and a topic you
 * come back to draws its widgets at once rather than one request each.
 */
export const HELD_OBJECT_FRESH_MS = 5 * 60_000

/** Every widget's object this tab resolved, by viewer and reference. */
const heldObjects = createListingCache<ForeignObject | null, true>({ freshMs: HELD_OBJECT_FRESH_MS })

type HeldLoad = () => Promise<ListingLoad<ForeignObject | null, true>>

/** A `kind:1851`: a change to one of a file's fields, its title and status among them (SPEC §6.7). */
const KIND_FIELD_CHANGE = 1851

/** Changes that land together — a rename, then a move — are asked about once. */
const FOLLOW_SETTLE_MS = 250

/**
 * At most one read of a file per this, however many changes name it: anyone who
 * may write in an open Folder can publish field changes, and each one would
 * otherwise cost every viewer of the file a read.
 */
const FOLLOW_MIN_GAP_MS = 2_000

/** The held objects something on screen draws, each following its file's field changes, by key and Folder. */
const following = new Map<string, { count: number; leave: () => void }>()

/**
 * A held object's key: the viewer and the reference, spelt one way — a widget
 * has `naddr1…` and a chip `nostr:naddr1…`, and the same file drawn both ways
 * is one object, asked for once.
 */
const heldKey = (pubkey: string, reference: string) => `${pubkey} ${reference.replace(/^nostr:/i, '')}`

/**
 * Keep a held object in step with its file while something draws it.
 *
 * The hold (OPT-3) made a widget draw at once on a return, and made it keep
 * what it first read: a title or status changed in Ship stayed old in the
 * open topic for up to {@link HELD_OBJECT_FRESH_MS}. The file's own Folder
 * says when it changes — a `kind:1851` naming it by `a` — and that Folder is
 * often not the topic's, so the topic's own watch never hears it. So each
 * object drawn joins the shared watch of its file's Folder for field changes
 * (on the topic's own watch, when it is the same Folder) and asks for that one
 * object again when its file changes. The conversation it sits in is not read.
 *
 * A file this viewer cannot read, or a thing with no address, follows nothing.
 * Without a socket nothing is heard, and the hold's age refreshes it as before.
 */
function followHeld(key: string, folder: string | undefined, address: string | undefined, load: HeldLoad): () => void {
  if (!folder || !address) return () => {}
  // By Folder and address too: a file moved to another Folder is followed there, whoever else still follows the old one.
  const id = `${key}\u0001${folder}\u0001${address}`
  const held = following.get(id)
  if (held) {
    held.count += 1
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastAsked = -Infinity
    const leave = joinFolderWatch(folder, [KIND_FIELD_CHANGE], (event) => {
      if (timer || !event.tags.some((tag) => tag[0] === 'a' && tag[1] === address)) return
      timer = setTimeout(
        () => {
          timer = undefined
          lastAsked = Date.now()
          // A read already in flight may have asked before the change: ask after it.
          void Promise.resolve(heldObjects.peek(key)?.inflight).then(() => heldObjects.read(key, load))
        },
        Math.max(FOLLOW_SETTLE_MS, lastAsked + FOLLOW_MIN_GAP_MS - Date.now()),
      )
    })
    following.set(id, {
      count: 1,
      leave: () => {
        clearTimeout(timer)
        leave()
      },
    })
  }
  return () => {
    const entry = following.get(id)
    if (!entry || --entry.count > 0) return
    following.delete(id)
    entry.leave()
  }
}

/** One reference's object, resolved as the viewer — the held objects' load. */
function heldLoad(reference: string, viewer: ReturnType<typeof useRelayViewer>): HeldLoad {
  return async () => {
    const v = viewer()
    if (!v) return { ok: true, value: null }
    try {
      return { ok: true, value: await pooledResolve(reference, v.relayUrl, v.token) }
    } catch {
      return { ok: false, failure: true }
    }
  }
}

/**
 * The widgets a conversation draws, asked in one read (OPT-10; Miky, 12 Oct:
 * "one batched load"): every reference asked in the same tick, by the same
 * viewer, goes to `resolveObjectsAsViewer` together — one POST for a screen of
 * cards rather than one each, against the 300-a-minute meter the tab shares.
 * A refused pooled read fails each of them, as a failed single read did.
 */
const pools = new Map<string, { relayUrl: string; token: StoredToken; asked: Map<string, { resolve: (value: ForeignObject | null) => void; reject: (error: unknown) => void }[]> }>()

function pooledResolve(reference: string, relayUrl: string, token: StoredToken): Promise<ForeignObject | null> {
  const key = `${relayUrl}\u0000${token.pubkey}`
  let pool = pools.get(key)
  if (!pool) {
    const fresh = { relayUrl, token, asked: new Map<string, { resolve: (value: ForeignObject | null) => void; reject: (error: unknown) => void }[]>() }
    pools.set(key, fresh)
    pool = fresh
    setTimeout(() => {
      pools.delete(key)
      const refs = [...fresh.asked.keys()]
      resolveObjectsAsViewer(refs, fresh.relayUrl, fresh.token).then(
        (objects) => {
          for (const [ref, waiting] of fresh.asked) for (const w of waiting) w.resolve(objects[ref] ?? null)
        },
        (error) => {
          for (const waiting of fresh.asked.values()) for (const w of waiting) w.reject(error)
        },
      )
    }, 0)
  }
  const asked = pool.asked
  return new Promise((resolve, reject) => {
    asked.set(reference, [...(asked.get(reference) ?? []), { resolve, reject }])
  })
}

/**
 * One reference's object for a message's widget, held for the tab: drawn at
 * once when it was resolved before, asked again only once it is older than
 * {@link HELD_OBJECT_FRESH_MS} or when its file changes while it is drawn, and
 * `reload` after an action. `null` asks for nothing and answers null.
 */
export function useHeldObject(reference: string | null): {
  object: ForeignObject | null | 'loading'
  reload: () => Promise<void>
  /** `object` is null because the relay answered with nothing — not because the read failed (OPT-10). */
  gone: boolean
} {
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey
  const key = reference && pubkey ? heldKey(pubkey, reference) : null
  const entry = useListing(heldObjects, key)

  const load = useCallback<HeldLoad>(
    () => (reference ? heldLoad(reference, viewer)() : Promise.resolve({ ok: true, value: null })),
    [reference, viewer],
  )

  useEffect(() => {
    if (!key || !reference) return
    // Never resolved in this tab: the copy on the device draws it until the relay answers (PEE-4).
    const v = heldObjects.peek(key)?.value === undefined ? viewer() : null
    if (v) {
      resolveObjectFromCopy(reference, v.relayUrl, v.token)
        .then((object) => {
          if (object && !object.unreachable) heldObjects.seed(key, object)
        })
        .catch(() => {})
    }
    void heldObjects.revalidate(key, load)
  }, [key, reference, viewer, load])

  const folder = entry?.value && !entry.value.unreachable ? entry.value.folder : undefined
  const address = entry?.value?.address
  useEffect(() => (key ? followHeld(key, folder, address, load) : undefined), [key, folder, address, load])

  const reload = useCallback(async () => {
    if (key) await heldObjects.read(key, load)
  }, [key, load])

  const object = !key ? null : entry?.value !== undefined ? entry.value : entry?.failure ? null : 'loading'
  return { object, reload, gone: !!key && entry?.value === null }
}

/**
 * Ask a file this tab holds again, by any spelling it was held under: after
 * this tab changed it (a rename, a summary), so a listing drawing held copies
 * (`useResolvedReferences`'s `held`) shows the change. A file not held is not
 * asked.
 */
export function useReloadHeldObject(): (reference: string) => Promise<void> {
  const viewer = useRelayViewer()
  return useCallback(
    async (reference: string) => {
      const pubkey = viewer()?.token.pubkey
      if (!pubkey) return
      const key = heldKey(pubkey, reference)
      if (heldObjects.peek(key)?.value === undefined) return
      await heldObjects.read(key, heldLoad(reference, viewer))
    },
    [viewer],
  )
}

export function useForeignObjects() {
  const viewer = useRelayViewer()

  const resolveObject = useCallback(
    async (naddr: string, options?: ArchiveReadOptions): Promise<ForeignObject | null> => {
      const v = viewer()
      return v ? resolveObjectAsViewer(naddr, v.relayUrl, v.token, options) : null
    },
    [viewer],
  )

  /** {@link resolveObject} from the copy on the device, or undefined where it cannot answer (PEE-4). */
  const resolveObjectFromDevice = useCallback(
    async (naddr: string, options?: ArchiveReadOptions): Promise<ForeignObject | undefined> => {
      const v = viewer()
      return v ? resolveObjectFromCopy(naddr, v.relayUrl, v.token, options) : undefined
    },
    [viewer],
  )

  /**
   * Many references for one request (PER-10) — see `resolveObjectsAsViewer`.
   * Every reference is a key; signed out, each is null, as `resolveObject`
   * answers. Rejects when the relay refuses the read.
   */
  const resolveObjects = useCallback(
    async (references: readonly string[], source: ReadSource = 'relay'): Promise<Record<string, ForeignObject | null>> => {
      const v = viewer()
      return v
        ? resolveObjectsAsViewer(references, v.relayUrl, v.token, source)
        : Object.fromEntries(references.map((reference) => [reference, null]))
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
    async (files: ForeignObject[], source: ReadSource = 'relay'): Promise<Record<string, ConversationMessage[]>> => {
      const v = viewer()
      return v ? conversationsAsViewer(files, v.relayUrl, v.token, source) : {}
    },
    [viewer],
  )


  const resolveFolderContents = useCallback(
    /** `includeArchived`: the archived files too, each with its `archived` — the Archive view's read (5 October). */
    /** `read`: the load this read is part of ({@link folderLoad}); a load of its own when left out. */
    async (folder: string, options?: { includeArchived?: boolean }, read?: QueryFn): Promise<FolderContents> => {
      const v = viewer()
      return v
        ? resolveFolderContentsAsViewer(folder, v.relayUrl, v.token, options, 'relay', read)
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
  const listFolders = useCallback(
    /** `read`: the load this read is part of ({@link folderLoad}); a load of its own when left out. */
    async (read?: QueryFn): Promise<FolderSummary[] | null> => {
      const v = viewer()
      return v ? listFoldersAsViewer(v.relayUrl, v.token, 'relay', read) : null
    },
    [viewer],
  )

  /**
   * {@link listFolders} and {@link resolveFolderContents} as the copy on the
   * device answers them (PEE-4): drawn until the relay answers. Each rejects
   * where the copy has not seen every read it makes.
   */
  const listFoldersFromDevice = useCallback(async (): Promise<FolderSummary[] | null> => {
    const v = viewer()
    return v ? listFoldersAsViewer(v.relayUrl, v.token, 'copy') : null
  }, [viewer])
  const resolveFolderContentsFromDevice = useCallback(
    async (folder: string): Promise<FolderContents | undefined> => {
      const v = viewer()
      return v ? resolveFolderContentsAsViewer(folder, v.relayUrl, v.token, undefined, 'copy') : undefined
    },
    [viewer],
  )

  /** Rename a Folder — its channel's name only, see {@link renameFolderAsViewer}. */
  const renameFolder = useCallback(
    async (folder: string, name: string) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to rename a folder.' }
      return renameFolderAsViewer(folder, name, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Whether Delete may be offered on a Folder — see `folderDeletableAsViewer`.
   * Signed out is a no, like any other.
   */
  const folderDeletable = useCallback(
    async (folder: string) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to delete a folder.' }
      return folderDeletableAsViewer(folder, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Delete a Folder. Everything carrying its `h` stops answering for everyone,
   * so the Folder is checked again first and refused if it holds anything.
   */
  const deleteFolder = useCallback(
    async (folder: string) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to delete a folder.' }
      return deleteFolderAsViewer(folder, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Move a file out of every Folder in `from` — the ones that list it now —
   * into `to`, adding to the target first. Each side's `hasState` comes from a
   * read: a move into or out of a Folder with no state is refused, because
   * either command would empty it (FOL-10). What each source lists beneath
   * `file` moves with it, archived files included, so each source is read
   * again here, at the move (FOL-45, SHI-37, SPEC §3.3).
   */
  const moveFile = useCallback(
    async (file: MovableFile, from: readonly FolderRef[], to: FolderRef) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to move a file.' }
      // Every source, a Folder with no state too: it lists the file by containment, and the planner
      // must see that to refuse the move rather than report one that never happened.
      const sources = from.filter((folder) => folder.id !== to.id)
      const read = await Promise.all(
        sources.map((folder) => resolveFolderContentsAsViewer(folder.id, v.relayUrl, v.token, { includeArchived: true }).then((contents) => contents.files, () => null)),
      )
      if (read.some((files) => files === null)) return { ok: false as const, reason: 'The Folder it is in could not be read, so nothing was moved. Try again.' }
      const listings = new Map(sources.map((folder, i) => [folder.id, read[i]!] as const))
      return moveFileAsViewer(file, listings, from, to, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * Start a topic in a Folder — a bare file, SPEC §6.7. `parent` is the
   * address of the file it sits under, of any kind. `hasState` comes from the
   * Folder read on the page, never from a guess; see `publishTopicAsViewer`.
   * Answers as soon as the topic can be opened, before it is written (PEE-6).
   */
  const createTopic = useCallback(
    async (args: StartTopicArgs) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to start a topic.' }
      return startTopicAsViewer(args, v.relayUrl, v.token)
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

  /**
   * Archive a file, or restore it, through its manifest's archive action
   * (FOL-46) — see `archiveFileAsViewer`. `actionId` is
   * `fileControlsOf(file).archive.id`.
   */
  const archiveFile = useCallback(
    async (args: { naddr: string; actionId: string; archived: boolean; resolution?: string }) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to archive a file.' }
      return archiveFileAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** Archive a Folder, or restore it — see `archiveFolderAsViewer`. */
  const archiveFolder = useCallback(
    async (args: { folder: string; channel: string; archived: boolean; resolution?: string }) => {
      const v = viewer()
      if (!v) return { ok: false as const, reason: 'Sign in to archive a folder.' }
      return archiveFolderAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /**
   * What archiving a file or a Folder (its channel address) would hide — the
   * read the dialog counts from. Throws when it cannot be read: a warning with
   * no counts would say it hides nothing.
   */
  const archiveImpact = useCallback(
    async (address: string, folders?: FolderSummary[]): Promise<ArchiveImpact> => {
      const v = viewer()
      if (!v) throw new Error('Sign in to archive.')
      return archiveImpactAsViewer(address, v.relayUrl, v.token, folders)
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
      /** The prose value's format, when it is a block document (MAN-1). */
      contentFormat?: string
      /** The declaring manifest, for another app's action on this object (MAN-8). */
      declaredBy?: string
    }): Promise<ActResult & { created?: string; incomplete?: string }> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to change another app’s object.' }
      return applyActionAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** A status or an owner changed from a file's card — see `cardActionAsViewer`. */
  const applyCardAction = useCallback(
    async (args: { naddr: string; actionId: string; value: string }): Promise<ActResult> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to change another app’s object.' }
      return cardActionAsViewer(args, v.relayUrl, v.token)
    },
    [viewer],
  )

  /** Whether a file is archived with a file above it, the closest at any depth (an issue in an archived project), else `undefined`. One more read than a card's resolve. */
  const parentArchiveOf = useCallback(
    async (naddr: string): Promise<ForeignObject['archived'] | undefined> => {
      const v = viewer()
      if (!v) return undefined
      const file = await resolveObjectAsViewer(naddr, v.relayUrl, v.token, { archivedWith: true }).catch(() => null)
      return file?.archived?.with ? file.archived : undefined
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

  /**
   * The same for the file pane that cannot comment, with the replies whose
   * comment was deleted under a stand-in for it — see `fileThreadsAsViewer`.
   * One more read than `threads`, so the Desk's hover keeps that one.
   */
  const fileThreads = useCallback(
    async (reference: string, rootIds: readonly string[]): Promise<FileThreads> => {
      const v = viewer()
      return v ? fileThreadsAsViewer(reference, rootIds, v.relayUrl, v.token) : { roots: {}, replies: {} }
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

  /**
   * Start a conversation in one of the person's DMs from the launcher (REC-1):
   * the message the DM's own composer sends — `buildMessage`, by Peek's chat
   * code — since a DM is not a Folder and the Folder's Start a conversation is
   * not offered on one (SPEC §3.2).
   */
  const startConversationInDm = useCallback(
    async (args: { channel: string; body: string }): Promise<ActResult> => {
      const v = viewer()
      if (!v) return { ok: false, reason: 'Sign in to write.' }
      return commentAsViewer({ container: { kind: 'channel', h: args.channel }, body: args.body }, v.relayUrl, v.token)
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

  /** Whether a channel is a DM rather than a Folder — see `dmForChannelAsViewer`. */
  const dmForChannel = useCallback(
    async (uuid: string): Promise<DmChannel> => {
      const v = viewer()
      return v ? dmForChannelAsViewer(uuid, v.relayUrl, v.token) : null
    },
    [viewer],
  )

  return {
    resolveObject,
    resolveObjectFromDevice,
    resolveObjects,
    resolveFileAddress,
    resolveFolderProject,
    resolveFolderContents,
    resolveFolderContentsFromDevice,
    conversations,
    listFolders,
    listFoldersFromDevice,
    createFolder,
    createTopic,
    renameFile,
    deleteFile,
    archiveFile,
    archiveFolder,
    archiveImpact,
    renameFolder,
    folderDeletable,
    deleteFolder,
    moveFile,
    applyAction,
    applyCardAction,
    parentArchiveOf,
    startConversationInDm,
    threads,
    fileThreads,
    replyToComment,
    creatableUnder,
    placeForReference,
    dmForChannel,
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
 * Nothing is asked for at all without a relay and a token (`hasRelay`, the
 * viewer), so tests, Storybook and no-backend checkouts settle immediately on
 * "resolved to nothing" rather than hanging on a request that cannot be made.
 *
 * One read for the whole list (PER-10), which matters more for Open work's
 * files than for a body's two mentions: every address shares a POST. A refused
 * read answers null for all of them, as a failed resolve did for each.
 */
export function useResolvedReferences(
  references: readonly string[],
  /**
   * Follow each file's field changes while drawn, as a widget does, and draw
   * this tab's newer held copy over the first answer: for what an open
   * conversation draws (a message's chips, the Activity's titles) and for
   * Open work's short list (PEE-28), not for a Folder listing, where it would
   * be a watch for every Folder listed.
   */
  options?: { live?: boolean },
): Record<string, ForeignObject | null> {
  const live = options?.live ?? false
  const { resolveObjects } = useForeignObjects()
  const viewer = useRelayViewer()
  const pubkey = viewer()?.token.pubkey ?? ''
  const [objects, setObjects] = useState<Record<string, ForeignObject | null>>({})
  // The identity of the array changes on every render; the list of references
  // in a message does not. Keying the effect on the contents rather than the
  // array is what stops it re-resolving for ever.
  const key = references.join('\u0000')

  /*
    Shared with the widgets' held objects (OPT-3): a reference this tab
    resolved in the last few minutes is drawn at once and not asked again, so
    a topic you come back to draws its Activity's titles with no request.
  */
  useEffect(() => {
    if (!hasRelay) return
    const refs = key ? key.split('\u0000') : []
    const ask = refs.filter((ref) => {
      const held = heldObjects.peek(heldKey(pubkey, ref))
      return held?.value === undefined || Date.now() - held.at >= HELD_OBJECT_FRESH_MS
    })
    if (!ask.length) return
    let cancelled = false
    let answered = false
    /*
      The copy on the device beside the relay (PEE-2): what it can resolve is
      drawn until the relay answers, and only what it found — a file the copy
      cannot place is the relay's to call missing, not the copy's. Nothing from
      it is held, so the next ask goes to the relay. Only what this tab never
      held: a stale one is on screen already (PEE-4).
    */
    const unheld = ask.filter((ref) => heldObjects.peek(heldKey(pubkey, ref))?.value === undefined)
    if (unheld.length) resolveObjects(unheld, 'copy')
      .then((objects) => {
        if (cancelled || answered) return
        const found = Object.entries(objects).filter(([, value]) => value)
        if (found.length) setObjects((prev) => ({ ...Object.fromEntries(found), ...prev }))
      })
      .catch(() => {})
    resolveObjects(ask)
      .catch(() => Object.fromEntries(ask.map((ref) => [ref, null])))
      // One setState for the whole body rather than one per reference: a
      // message with four mentions should not lay out four times.
      .then((objects) => {
        if (cancelled) return
        answered = true
        for (const [ref, value] of Object.entries(objects)) {
          if (value && pubkey) void heldObjects.read(heldKey(pubkey, ref), async () => ({ ok: true, value }))
        }
        setObjects(objects)
      })
    return () => {
      cancelled = true
    }
  }, [key, resolveObjects, pubkey])

  /*
    A held object is asked again when its file changes (`followHeld`), so it is
    the newer answer: drawn over this hook's own, and a change to it draws again.
  */
  const [heldChanges, setHeldChanges] = useState(0)
  useEffect(() => {
    // Only what follows: a listing draws what it read, and a held change elsewhere is not a reason to draw it again.
    if (!live || !hasRelay || !pubkey || !key) return
    const leave = key.split('\u0000').map((ref) => heldObjects.subscribe(heldKey(pubkey, ref), () => setHeldChanges((n) => n + 1)))
    return () => leave.forEach((each) => each())
  }, [live, key, pubkey])

  const merged = useMemo(() => {
    void heldChanges
    const held = (key ? key.split('\u0000') : []).flatMap((ref) => {
      // A listing keeps its own answer first, as before; it fills only what it has not answered.
      if (!live && objects[ref]) return []
      const value = heldObjects.peek(heldKey(pubkey, ref))?.value
      return value && value !== objects[ref] ? [[ref, value] as const] : []
    })
    return held.length ? { ...objects, ...Object.fromEntries(held) } : objects
  }, [live, key, objects, pubkey, heldChanges])

  // What is drawn, followed while it is: by Folder and address, so a re-read that changes nothing re-joins nothing.
  const follow = live
    ? Object.entries(merged)
        .flatMap(([ref, object]) =>
          object && !object.unreachable && object.folder && object.address ? [`${ref}\u0001${object.folder}\u0001${object.address}`] : [],
        )
        .sort()
        .join('\u0000')
    : ''
  useEffect(() => {
    if (!follow || !pubkey) return
    const leave = follow.split('\u0000').map((each) => {
      const [ref, folder, address] = each.split('\u0001')
      return followHeld(heldKey(pubkey, ref), folder, address, heldLoad(ref, viewer))
    })
    return () => leave.forEach((each) => each())
  }, [follow, pubkey, viewer])

  /*
    Demo mode is derived, not set. There is no relay to ask without a
    deployment, so every reference has resolved to nothing before the first
    render — and writing that into state from the effect body is a cascading
    render for an answer that was never in doubt. `useWorkspaceDirectory` below
    keeps setState out of its effect for the same reason.
  */
  if (!hasRelay) {
    return Object.fromEntries((key ? key.split('\u0000') : []).map((ref) => [ref, null]))
  }
  return merged
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
    hasRelay ? directoryCache?.people : DEMO_DIRECTORY,
  )

  useEffect(() => {
    if (!hasRelay || people !== undefined) return
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
 * How short a query is still not asked of the relay — `[`'s own floor, for
 * files and messages alike (Miky, 2026-10-19): one letter starts too many words.
 */
const SEARCH_MIN = 2

/**
 * Search message content over NIP-50 (PEE-4), from the second letter typed.
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
  const typed = query.trim()
  const term = typed.length >= SEARCH_MIN ? typed : ''

  useEffect(() => {
    // Nothing to ask, or nowhere to ask it: both are derived states, not
    // fetches. Demo mode has no relay at all.
    if (!term || !hasRelay) return
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
            state: { kind: 'failed', failure: relayFailureKind(error) },
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
      !hasRelay
      ? { kind: 'signed-out' }
      : (fresh?.state ?? { kind: 'searching' })

  return { state, hits: fresh?.hits ?? [] }
}


/**
 * The launcher's Files (SUM-7, Miky at kickoff): the files whose current
 * title holds what was typed, as `[`'s search tier finds them — each with its
 * summary, and an issue with its project. Titles only, never a body. Asked
 * after the same pause as messages, and only from two letters, as `[` asks;
 * ranked as `[` ranks them, the best match and an open file first.
 */
export function useFileSearch(query: string): { state: MessageSearchState; hits: ReferenceCandidate[] } {
  const viewer = useRelayViewer()
  const [answer, setAnswer] = useState<{ term: string; state: MessageSearchState; hits: ReferenceCandidate[] } | null>(null)
  const typed = query.trim()
  const term = typed.length >= SEARCH_MIN ? typed : ''

  useEffect(() => {
    if (!term || !hasRelay) return
    let cancelled = false
    const timer = setTimeout(() => {
      const v = viewer()
      if (!v) {
        if (!cancelled) setAnswer({ term, state: { kind: 'signed-out' }, hits: [] })
        return
      }
      searchFileReferencesAsViewer(term, v.relayUrl, v.token)
        .then((found) => rankReferences({ messages: [], files: found, query: term, ownKinds: [KIND_BARE_FILE], caps: { messages: 0, files: found.length } }).files)
        .then((hits) => {
          if (!cancelled) setAnswer({ term, state: { kind: 'done', count: hits.length }, hits })
        })
        .catch((error: unknown) => {
          if (!cancelled) setAnswer({ term, state: { kind: 'failed', failure: relayFailureKind(error) }, hits: [] })
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, viewer])

  const fresh = answer?.term === term ? answer : null
  const state: MessageSearchState = !term ? { kind: 'idle' } : !hasRelay ? { kind: 'signed-out' } : (fresh?.state ?? { kind: 'searching' })
  return { state, hits: fresh?.hits ?? [] }
}
