/**
 * Open work — the list on the relay, the rendering from Convex.
 *
 * SHR-9 flipped which of those is the truth. `deskOpenWork` was the cleanest
 * layer-2 case left in Peek: four fields, every one authored by the person who
 * put a conversation in front of themselves, one index (`by_user`), and every
 * access that index followed by a JS `.some()`. It meets none of ADR 0001 §3's
 * five, so `api.desk.openWorkList` had no business being what rendered. Now the
 * blob is the list and Convex is out of that read.
 *
 * ## The list and the rendering are two different things, and mixing them is a bug
 *
 * The list is ids: topic ids and person keys, in order, and nothing else is
 * published. Rendering resolves those through `useTopics()` and `usePeople()` —
 * a title, a resolved state, a name, an avatar — which is ADR 0001's layer 3
 * doing exactly what it is for. An id the index cannot resolve is dropped from
 * `items` and **kept in the list**: they are separate values here for that
 * reason. Deriving the publish from the rendered rows instead would drop a row
 * from the person's list every time the workspace index was a beat behind,
 * permanently, because the blob is last-write-wins. SHR-6 states the same rule
 * for stars; it is the trap that ticket names and the reason this one repeats it.
 *
 * The cost of that rule, paid deliberately: an id whose topic is deleted for
 * good stays in the blob. `convex/topics.ts:210` used to sweep *other people's*
 * rows when a topic was deleted, which layer 2 forbids and which is not needed —
 * a row whose target no longer resolves simply does not render, which is the
 * read-time healing PEE-6 relies on.
 *
 * ## Order is the state, and new work goes on the end
 *
 * Open work is a list, not a set: "latest added go last, kind of like a tab in a
 * browser; similarly to a tab, you should in future be able to change the order"
 * (Miky, 2026-09-16). Two consequences. The blob is one ordered `entries` array
 * rather than the stars blob's two sets — `src/nostr/openWork.ts` argues that
 * where the shape is defined. And this file **appends**, where the Convex query
 * it replaces sorted `addedAt` descending and put new work on top.
 *
 * The strictly-increasing `addedAt` `desk.ts:271-281` needed is kept client-side
 * for free, and better: `pending` is a `Map`, whose iteration order is insertion
 * order, so a batch added inside one millisecond cannot tie and cannot flip.
 * There are no timestamps left to tie.
 *
 * ## Where Convex still appears, and why it is temporary
 *
 * `api.desk.openWorkList` is read, and is not the list. It serves while the
 * relay has not answered — no origin configured, no token in this tab, or a read
 * that failed — and it is the seed for a person whose open work predates this
 * ticket, published the moment the relay says it holds nothing. It is read
 * oldest-first for that seed, reversing the query's newest-first sort, so a
 * seeded list comes out in the order the person built it. Both cases are bounded
 * by `useOpenWorkSync`'s `state`; neither can fire once a blob exists.
 *
 * The mutations still write Convex on every change, which is what makes that
 * fallback safe — and it is also what keeps `nostr/sync.ts`'s `watchableChannels`
 * and `desk.screenerList`'s de-duplication reading the same rows they always
 * have. They can move to the client (and this table can be dropped) only after
 * the dual-write is no longer needed to recover from a failed publish.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { OPEN_WORK_ITEMS } from '@/data/deskData'
import { hasConvex } from '@/api/store'
import { usePeople } from '@/api/people'
import { useTopics } from '@/api/topics'
import { useResolvedReferences } from '@/api/foreign'
import { useOpenWorkSync } from '@/nostr/useOpenWorkSync'
import { openWorkKey, type OpenWorkRef } from '@/nostr/openWork'
import type { OpenWorkItem } from '@/api/types'

/** Overlay keys. The three prefixes cannot shadow each other. */
const TOPIC = 'topic:'
const PERSON = 'dm:'
const FILE = 'file:'

export interface OpenWorkValue {
  /** The rendered rows, in the person's order. Never the list — see the header. */
  items: OpenWorkItem[]
  /** Topic ids in the list, from the list rather than from `items`. */
  topicIds: Set<string>
  /** File addresses in the list, from the list for the same reason (FOL-34). */
  fileAddresses: Set<string>
  /** True until a source has settled and there is a list to render. */
  isLoading: boolean
  addTopics: (topicIds: string[]) => void
  addDm: (dmId: string) => void
  addFile: (address: string) => void
  removeTopic: (topicId: string) => void
  removeDm: (dmId: string) => void
  removeFile: (address: string) => void
}

const OpenWorkContext = createContext<OpenWorkValue | null>(null)

export function OpenWorkProvider({ children }: { children: ReactNode }) {
  // Mock-mode state (full source of truth without a deployment).
  const [mockItems, setMockItems] = useState<OpenWorkItem[]>(OPEN_WORK_ITEMS)
  // Session changes applied over the settled list until it catches up. `true`
  // is an addition and `false` a removal; insertion order is append order, and
  // is why nothing here needs a timestamp.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map())

  // Where the relay lives — a query rather than a build-time variable, so the
  // bundle and the backend cannot disagree about it (convex/nostr/config.ts).
  const relayUrl = useQuery(api.nostr.config.relayConfig, hasConvex ? {} : 'skip')?.relayUrl
  const sync = useOpenWorkSync(relayUrl)
  const convexOpenWork = useQuery(api.desk.openWorkList, hasConvex ? {} : 'skip')

  // Rendering only. Never the list — see the header.
  const topics = useTopics()
  const people = usePeople()

  const convexSet = useMemo<OpenWorkRef[] | undefined>(() => {
    if (convexOpenWork === undefined) return undefined
    // The query sorts `addedAt` descending. The list is oldest-first, so the
    // seed reverses it rather than freezing the old presentation order into the
    // blob, where it would then be the person's order for ever.
    return [...convexOpenWork]
      .reverse()
      .map((w) =>
        w.kind === 'dm'
          ? ({ kind: 'dm', key: w.dmId } as const)
          : ({ kind: 'topic', id: w.topicId } as const),
      )
  }, [convexOpenWork])

  const relaySet = useMemo<OpenWorkRef[] | undefined>(() => {
    if (sync.state !== 'present' || !sync.relayBlob) return undefined
    return sync.relayBlob.entries
  }, [sync.state, sync.relayBlob])

  /** The list as last settled, before this session's changes. */
  const settledSet = relaySet ?? convexSet

  const effectiveSet = useMemo<OpenWorkRef[] | undefined>(() => {
    if (!settledSet) return undefined
    // Untouched this session keeps its settled position; anything added this
    // session is appended, *including* one that was already in the list. Adding
    // something back is putting it in front of yourself again, so it belongs at
    // the end — filtering on `!== false` instead would leave a re-added entry in
    // the slot it was removed from, which is the order the person just changed.
    const kept = settledSet.filter((e) => pending.get(openWorkKey(e)) === undefined)
    // Re-added entries keep the relay identity the blob already carried for
    // them, rather than being rebuilt bare and waiting on the index for it.
    const settledByKey = new Map(settledSet.map((e) => [openWorkKey(e), e]))
    const added: OpenWorkRef[] = []
    for (const [key, isAdded] of pending) {
      if (!isAdded) continue
      const settled = settledByKey.get(key)
      if (settled) added.push(settled)
      else if (key.startsWith(PERSON)) added.push({ kind: 'dm', key: key.slice(PERSON.length) })
      else if (key.startsWith(TOPIC)) added.push({ kind: 'topic', id: key.slice(TOPIC.length) })
      else if (key.startsWith(FILE)) added.push({ kind: 'file', address: key.slice(FILE.length) })
    }
    return [...kept, ...added]
  }, [settledSet, pending])

  const topicById = useMemo(() => new Map((topics ?? []).map((t) => [t.id, t])), [topics])
  const personByKey = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people])

  /*
    A file's row is rendered from the relay, not from a workspace index: it has
    no Convex id and no Convex copy (FOL-34). One `resolveObject` per file, once
    per change to the set — a title is not something that needs a refresh, and
    the unread badge is read separately, by the Desk, where it is drawn.
  */
  const fileAddresses = useMemo(
    () => new Set((effectiveSet ?? []).flatMap((e) => (e.kind === 'file' ? [e.address] : []))),
    [effectiveSet],
  )
  const fileObjects = useResolvedReferences(useMemo(() => [...fileAddresses].sort(), [fileAddresses]))

  const items = useMemo<OpenWorkItem[]>(() => {
    if (!hasConvex) return mockItems
    if (!effectiveSet) return []
    const out: OpenWorkItem[] = []
    for (const entry of effectiveSet) {
      if (entry.kind === 'file') {
        // Unresolved (still asking, deleted, or unreadable): no row, and the
        // address stays in the list — the rule every other kind follows.
        const object = fileObjects[entry.address]
        if (!object) continue
        out.push({
          id: `ow_file_${entry.address}`,
          kind: 'file',
          address: entry.address,
          title: object.slots.title?.value ?? 'File',
          object,
        })
      } else if (entry.kind === 'dm') {
        const person = personByKey.get(entry.key)
        if (!person) continue
        out.push({
          id: `ow_dm_${entry.key}`,
          kind: 'dm',
          dmId: entry.key,
          name: person.name,
          avatarSrc: person.avatarSrc,
        })
      } else {
        const topic = topicById.get(entry.id)
        // Not in the index: deleted, or the index has not arrived. Either way
        // there is no row to draw — and the id stays in the list regardless.
        if (!topic) continue
        out.push({
          id: `ow_topic_${entry.id}`,
          kind: 'topic',
          topicId: entry.id,
          title: topic.title,
          topicStatus: topic.isResolved ? 'resolved' : 'unresolved',
        })
      }
    }
    return out
  }, [mockItems, effectiveSet, topicById, personByKey, fileObjects])

  /*
    Publish the list the person owns, not the change that produced it.

    Driving this from the handlers would publish twice per change — once
    optimistically and once when the list caught up — and would miss a row that
    arrived from another tab. `openWorkToPublish` returns undefined for an
    unchanged list, so a re-render costs nothing.

    The guard SHR-6 had to keep, in its new form. It used to be
    `remote === undefined`: do not publish while the Convex query is in flight,
    because a briefly-empty list is a last-write-wins publish that makes the loss
    permanent. Convex is no longer what is being waited for, and two things are —
    the relay's own answer, guarded inside `useOpenWorkSync`, and whichever
    source the list came from, which is `effectiveSet` being undefined here.

    The relay identities are enriched from the workspace index but never gated on
    it: an entry the index cannot resolve keeps whatever the blob already carried,
    so a beat-behind index costs a `channelUuid` on one publish and never an
    entry. Membership does not depend on `topics`/`people`; only decoration does.

    Mock mode publishes nothing: there is no session and no relay, and a fixture
    is not the person's data.
  */
  const publishList = sync.publish
  const publishEntries = useMemo<OpenWorkRef[] | undefined>(() => {
    if (!effectiveSet) return undefined
    return effectiveSet.map((entry) => {
      if (entry.kind === 'file') return entry
      if (entry.kind === 'dm') {
        const pubkey = personByKey.get(entry.key)?.pubkey ?? entry.pubkey
        return pubkey ? { kind: 'dm', key: entry.key, pubkey } : { kind: 'dm', key: entry.key }
      }
      const channelUuid = topicById.get(entry.id)?.folderId ?? entry.channelUuid
      return channelUuid ? { kind: 'topic', id: entry.id, channelUuid } : { kind: 'topic', id: entry.id }
    })
  }, [effectiveSet, topicById, personByKey])

  useEffect(() => {
    if (!hasConvex) return
    if (!publishEntries) return
    void publishList(publishEntries)
  }, [publishEntries, publishList])

  const topicIds = useMemo(() => {
    // The list, never `items`: a row whose topic the index has not delivered yet
    // is still in the list, and reading it off the rows would let the "+" picker
    // offer it again and add a second copy.
    if (!hasConvex) return new Set(mockItems.flatMap((w) => (w.kind === 'dm' || w.kind === 'file' ? [] : [w.topicId])))
    return new Set((effectiveSet ?? []).flatMap((e) => (e.kind === 'topic' ? [e.id] : [])))
  }, [mockItems, effectiveSet])

  const addTopics = useCallback(
    (ids: string[]) => {
      if (!hasConvex) {
        setMockItems((prev) => {
          const have = new Set(prev.flatMap((w) => (w.kind === 'dm' || w.kind === 'file' ? [] : [w.topicId])))
          const rows = ids
            .filter((id) => !have.has(id))
            .map((id) => ({
              id: `ow_topic_${id}`,
              kind: 'topic' as const,
              topicId: id,
              title: topicById.get(id)?.title ?? id,
              topicStatus: (topicById.get(id)?.isResolved ? 'resolved' : 'unresolved') as 'resolved' | 'unresolved',
            }))
          return [...prev, ...rows]
        })
        return
      }
      setPending((prev) => {
        const next = new Map(prev)
        for (const id of ids) {
          // Delete before set, so a re-add lands at the end of the order rather
          // than back in the slot a removal left behind.
          next.delete(`${TOPIC}${id}`)
          next.set(`${TOPIC}${id}`, true)
        }
        return next
      })
    },
    [topicById],
  )

  const addDm = useCallback((dmId: string) => {
    if (!hasConvex) return
    setPending((prev) => {
      const next = new Map(prev)
      next.delete(`${PERSON}${dmId}`)
      next.set(`${PERSON}${dmId}`, true)
      return next
    })
  }, [])

  /*
    Relay only, in both modes' sense: mock mode has no relay to resolve a file
    from, so there is no row to add and nothing is pretended. The Convex
    dual-write the other kinds keep has no table to go to — see `OpenWorkFileRef`.
  */
  const addFile = useCallback((address: string) => {
    if (!hasConvex) return
    setPending((prev) => {
      const next = new Map(prev)
      next.delete(`${FILE}${address}`)
      next.set(`${FILE}${address}`, true)
      return next
    })
  }, [])

  const removeTopic = useCallback((topicId: string) => {
    if (!hasConvex) {
      setMockItems((prev) => prev.filter((w) => w.kind === 'dm' || w.kind === 'file' || w.topicId !== topicId))
      return
    }
    setPending((prev) => new Map(prev).set(`${TOPIC}${topicId}`, false))
  }, [])

  const removeFile = useCallback((address: string) => {
    if (!hasConvex) return
    setPending((prev) => new Map(prev).set(`${FILE}${address}`, false))
  }, [])

  const removeDm = useCallback((dmId: string) => {
    if (!hasConvex) {
      setMockItems((prev) => prev.filter((w) => w.kind !== 'dm' || w.dmId !== dmId))
      return
    }
    setPending((prev) => new Map(prev).set(`${PERSON}${dmId}`, false))
  }, [])

  // Not gated on `topics`/`people`: those settle only for a signed-in viewer,
  // and hanging on them would leave the Desk column under a skeleton for anyone
  // they never settle for.
  const isLoading = hasConvex && effectiveSet === undefined

  const value = useMemo<OpenWorkValue>(
    () => ({ items, topicIds, fileAddresses, isLoading, addTopics, addDm, addFile, removeTopic, removeDm, removeFile }),
    [items, topicIds, fileAddresses, isLoading, addTopics, addDm, addFile, removeTopic, removeDm, removeFile],
  )

  return <OpenWorkContext.Provider value={value}>{children}</OpenWorkContext.Provider>
}

/**
 * Seam-internal, and `null` outside the provider rather than a throw — for a
 * control on a row that a story or a test mounts on its own (`useFollows`'s rule).
 */
export function useOpenWorkIfMounted(): OpenWorkValue | null {
  return useContext(OpenWorkContext)
}

/** Seam-internal. Components never call this. */
export function useOpenWork(): OpenWorkValue {
  const ctx = useContext(OpenWorkContext)
  if (!ctx) throw new Error('useOpenWork must be used within PeekDataProvider')
  return ctx
}
