/**
 * Open work — the list on the relay, the rendering from the workspace.
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
 * The list is ids: person keys and file addresses, in order, and nothing else
 * is published. Rendering resolves those through `useWorkspacePeople()` and the
 * relay — a name, an avatar, a title — which is ADR 0001's layer 3 doing
 * exactly what it is for. An id that cannot be resolved is dropped from
 * `items` and **kept in the list**: they are separate values here for that
 * reason. Deriving the publish from the rendered rows instead would drop a row
 * from the person's list every time the workspace index was a beat behind,
 * permanently, because the blob is last-write-wins. SHR-6 states the same rule
 * for stars; it is the trap that ticket names and the reason this one repeats it.
 *
 * A Convex topic id is the case that rule now covers for good (FOL-23): the
 * topics are gone, so a topic entry never renders and is never added again,
 * and it is published back exactly as the blob held it — this file does not
 * delete what a person put in their own list.
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
 * ## Convex is out of it entirely (REM-4)
 *
 * `api.desk.openWorkList` used to serve while the relay had not answered and to
 * seed a person with no blob, and four mutations dual-wrote `deskOpenWork`. All
 * of that is gone: a person the relay holds no list for starts with an empty one
 * — Convex-only rows are dropped, not migrated (Miky, 2026-09-24).
 *
 * Nothing reads the old table since CON-14: the Screener's DM half, which
 * de-duplicated against `deskOpenWork`, is folded from the relay and checks
 * `dmIds` instead.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { OPEN_WORK_ITEMS } from '@/data/deskData'
import { hasRelay } from '@/api/relayUrl'
import { isPersonKey, useWorkspacePeople } from '@/api/people'
import { useResolvedReferences } from '@/api/foreign'
import { useOpenWorkSync } from '@/nostr/useOpenWorkSync'
import { openWorkKey, type OpenWorkRef } from '@/nostr/openWork'
import type { OpenWorkItem } from '@/api/types'
import { RELAY_URL } from '@/api/relayUrl'

/** Overlay keys. The two prefixes cannot shadow each other. */
const PERSON = 'dm:'
const FILE = 'file:'

const NO_ENTRIES: OpenWorkRef[] = []

export interface OpenWorkValue {
  /** The rendered rows, in the person's order. Never the list — see the header. */
  items: OpenWorkItem[]
  /** File addresses in the list, from the list rather than from `items` (FOL-34). */
  fileAddresses: Set<string>
  /** Partner pubkeys in the list, the same way — the Screener's DM half (CON-14). */
  dmIds: Set<string>
  /** True until the relay has answered and there is a list to render. */
  isLoading: boolean
  addDm: (dmId: string) => void
  addFile: (address: string) => void
  removeDm: (dmId: string) => void
  removeFile: (address: string) => void
}

const OpenWorkContext = createContext<OpenWorkValue | null>(null)

/**
 * A person in open work is their pubkey since REM-3, as a DM is everywhere
 * else. An entry written under the old Peek key moves to the pubkey the blob
 * stored beside it; one with none cannot be moved without Convex, so it is
 * dropped and the next publish deletes it rather than keeping a key nothing
 * can read. A second entry for the same person after the move is a duplicate.
 */
function normalizePeople(entries: readonly OpenWorkRef[]): OpenWorkRef[] {
  const seen = new Set<string>()
  const out: OpenWorkRef[] = []
  for (const entry of entries) {
    if (entry.kind !== 'dm') {
      out.push(entry)
      continue
    }
    const key = entry.pubkey ?? entry.key
    if (!isPersonKey(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ kind: 'dm', key, pubkey: key })
  }
  return out
}

export function OpenWorkProvider({ children }: { children: ReactNode }) {
  // Mock-mode state (full source of truth without a deployment).
  const [mockItems, setMockItems] = useState<OpenWorkItem[]>(OPEN_WORK_ITEMS)
  // Session changes applied over the settled list until it catches up. `true`
  // is an addition and `false` a removal; insertion order is append order, and
  // is why nothing here needs a timestamp.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map())

  // Where the relay lives — a build-time value since REM-2 (`@/api/relayUrl`).
  const relayUrl = RELAY_URL
  const sync = useOpenWorkSync(relayUrl)

  // Rendering only. Never the list — see the header.
  const people = useWorkspacePeople()

  const relaySet = useMemo<OpenWorkRef[] | undefined>(() => {
    if (sync.state !== 'present' || !sync.relayBlob) return undefined
    return normalizePeople(sync.relayBlob.entries)
  }, [sync.state, sync.relayBlob])

  /**
   * The list as last settled, before this session's changes. A relay that
   * holds no list is an empty one; a relay that has not answered is no list at
   * all, and nothing renders or publishes until it does.
   */
  const settledSet = relaySet ?? (sync.state === 'absent' ? NO_ENTRIES : undefined)

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
      else if (key.startsWith(FILE)) added.push({ kind: 'file', address: key.slice(FILE.length) })
    }
    return [...kept, ...added]
  }, [settledSet, pending])

  const personByKey = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people])

  /*
    A file's row is rendered from the relay, not from a workspace index: it has
    no Convex id and no Convex copy (FOL-34). One read for every file (PER-10),
    once per change to the set — a title is not something that needs a refresh,
    and the unread badge is read separately, by the Desk, where it is drawn.
  */
  const fileAddresses = useMemo(
    () => new Set((effectiveSet ?? []).flatMap((e) => (e.kind === 'file' ? [e.address] : []))),
    [effectiveSet],
  )
  const dmIds = useMemo(
    () => new Set((effectiveSet ?? []).flatMap((e) => (e.kind === 'dm' ? [e.key] : []))),
    [effectiveSet],
  )
  const fileObjects = useResolvedReferences(useMemo(() => [...fileAddresses].sort(), [fileAddresses]))

  const items = useMemo<OpenWorkItem[]>(() => {
    if (!hasRelay) return mockItems
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
      }
      // A topic entry draws nothing and stays in the list (FOL-23, the header).
    }
    return out
  }, [mockItems, effectiveSet, personByKey, fileObjects])

  /*
    Publish the list the person owns, not the change that produced it.

    Driving this from the handlers would publish twice per change — once
    optimistically and once when the list caught up — and would miss a row that
    arrived from another tab. `openWorkToPublish` returns undefined for an
    unchanged list, so a re-render costs nothing.

    The guard SHR-6 had to keep, in its new form. It used to be
    `remote === undefined`: do not publish while the Convex query is in flight,
    because a briefly-empty list is a last-write-wins publish that makes the loss
    permanent. Now the relay's own answer is what is waited for — guarded
    inside `useOpenWorkSync`, and here as `effectiveSet` being undefined.

    A topic entry is published back exactly as the blob held it (FOL-23).

    An `absent` relay publishes only once the person has changed something: an
    empty list published on load would overwrite a blob this version cannot
    read, which `absent` includes, and would write one per load for everybody
    who has never used open work.

    Mock mode publishes nothing: there is no session and no relay, and a fixture
    is not the person's data.
  */
  const publishList = sync.publish
  const publishEntries = useMemo<OpenWorkRef[] | undefined>(() => {
    if (!effectiveSet) return undefined
    // A person is their pubkey since REM-3; `normalizePeople` made it so.
    return effectiveSet.map((entry) => (entry.kind === 'dm' ? { kind: 'dm', key: entry.key, pubkey: entry.key } : entry))
  }, [effectiveSet])

  const untouchedAndAbsent = sync.state === 'absent' && pending.size === 0
  useEffect(() => {
    if (!hasRelay) return
    if (!publishEntries || untouchedAndAbsent) return
    void publishList(publishEntries)
  }, [publishEntries, untouchedAndAbsent, publishList])

  const addDm = useCallback((dmId: string) => {
    if (!hasRelay) return
    setPending((prev) => {
      const next = new Map(prev)
      // Delete before set, so a re-add lands at the end of the order rather
      // than back in the slot a removal left behind.
      next.delete(`${PERSON}${dmId}`)
      next.set(`${PERSON}${dmId}`, true)
      return next
    })
  }, [])

  /*
    Mock mode has no relay to resolve a file from, so there is no row to add
    and nothing is pretended.
  */
  const addFile = useCallback((address: string) => {
    if (!hasRelay) return
    setPending((prev) => {
      const next = new Map(prev)
      next.delete(`${FILE}${address}`)
      next.set(`${FILE}${address}`, true)
      return next
    })
  }, [])

  const removeFile = useCallback((address: string) => {
    if (!hasRelay) return
    setPending((prev) => new Map(prev).set(`${FILE}${address}`, false))
  }, [])

  const removeDm = useCallback((dmId: string) => {
    if (!hasRelay) {
      setMockItems((prev) => prev.filter((w) => w.kind !== 'dm' || w.dmId !== dmId))
      return
    }
    setPending((prev) => new Map(prev).set(`${PERSON}${dmId}`, false))
  }, [])

  // Not gated on `people`: that settles only for a signed-in viewer, and
  // hanging on it would leave the Desk column under a skeleton for anyone it
  // never settles for.
  const isLoading = hasRelay && effectiveSet === undefined

  const value = useMemo<OpenWorkValue>(
    () => ({ items, fileAddresses, dmIds, isLoading, addDm, addFile, removeDm, removeFile }),
    [items, fileAddresses, dmIds, isLoading, addDm, addFile, removeDm, removeFile],
  )

  return <OpenWorkContext.Provider value={value}>{children}</OpenWorkContext.Provider>
}

/**
 * Seam-internal, and `null` outside the provider rather than a throw — for a
 * control on a row that a story or a test mounts on its own (`useMembership`'s rule).
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
