/**
 * Starred conversations — the set on the relay, the rendering from the workspace.
 *
 * SHR-6 flipped which of those is the truth. CRO-11 had already published the
 * set as a SPEC §12 layer-2 blob (`src/nostr/stars.ts`) and restored from it on
 * request, but `api.desk.starsList` was still what rendered, so the relay copy
 * was a backup and the person could not take their stars anywhere. Now the blob
 * is the set and Convex is out of that read.
 *
 * ## The set and the rendering are two different things, and mixing them is a bug
 *
 * The set is ids: topic ids and person keys, and nothing else is published.
 * Rendering resolves the people through `useWorkspacePeople()` — a name, an
 * avatar — which is ADR 0001's layer 3 doing exactly what it is for. An id the
 * index cannot resolve is dropped from `entries` and **kept in the set**: they
 * are separate values here for that reason. Deriving the publish from the
 * rendered rows instead would drop a star from the person's set every time the
 * workspace index was a beat behind, permanently, because the blob is
 * last-write-wins.
 *
 * A starred Convex topic is the case that rule now covers for good (FOL-23):
 * the topics are gone, so a topic star never renders and cannot be toggled, and
 * it is published back exactly as the blob held it. Nothing prunes the blob,
 * because pruning means deciding for the person; a dead id costs a few dozen
 * bytes against a 65,535-byte limit the set is nowhere near.
 *
 * ## Both halves, not just topics
 *
 * The ticket scoped this to topics, on the grounds that starred people are
 * keyed by an app-local `dmId` with no portable identifier. That argument is
 * `stars.ts`'s, and it is an argument against **layer 1** — a NIP-51 set full
 * of Convex ids is one nobody else can read. At layer 2 `stars.ts:34-40` says
 * the opposite in as many words: only Peek reads this blob, so app-local ids
 * are legitimate rather than a compromise. Widened with Miky, 2026-09-16.
 *
 * ## Convex is out of it entirely (REM-4)
 *
 * `api.desk.starsList` used to serve while the relay had not answered, and to
 * seed a person with no blob; `desk.toggleStar` wrote Convex on every toggle so
 * that fallback stayed true. All three are gone: a person the relay holds no
 * set for starts with an empty one — Convex-only stars are dropped, not
 * migrated (Miky, 2026-09-24) — and a relay that has not answered renders the
 * skeleton rather than somebody else's copy of the truth. A failed publish is
 * now recoverable only from this session's overlay, and `useStarsSync` logs it.
 */
import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { STARRED_ENTRIES, type StarredEntry } from '@/data/deskData'
import { hasRelay } from '@/api/relayUrl'
import { isPersonKey, useWorkspacePeople } from '@/api/people'
import { useStarsSync } from '@/nostr/useStarsSync'
import { RELAY_URL } from '@/api/relayUrl'

const NO_STARS: StarSet = { topics: [], people: [] }

const byName = (a: StarredEntry, b: StarredEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** The person's set, as it is published: ids only. */
interface StarSet {
  /** Convex topic ids — carried, never drawn, since FOL-23. */
  topics: string[]
  people: string[]
}

/** Overlay key prefix. */
const PERSON = 'dm:'

interface StarDmInput {
  dmId: string
  name: string
  avatarSrc?: string
}

interface StarredContextValue {
  entries: StarredEntry[]
  isDmStarred: (dmId: string) => boolean
  toggleDm: (input: StarDmInput) => void
  /** True until the relay has answered and there is a set to render. */
  isLoading: boolean
}

const StarredContext = createContext<StarredContextValue | null>(null)

export function StarredProvider({ children }: { children: ReactNode }) {
  // Mock-mode state (full source of truth without a deployment).
  const [mockEntries, setMockEntries] = useState<StarredEntry[]>(STARRED_ENTRIES)
  // Session toggles applied over the settled set until it catches up. A plain
  // starred/not: the row to draw comes from the workspace index, which already
  // has whatever the person just clicked a star on.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map())

  // Where the relay lives — a build-time value since REM-2 (`@/api/relayUrl`).
  const relayUrl = RELAY_URL
  const stars = useStarsSync(relayUrl)

  // Rendering only. Never the set — see the header.
  const people = useWorkspacePeople()

  /*
    A starred person is their pubkey since REM-3 — the DM's id everywhere else.
    A star written under the old Peek key moves to the pubkey stored beside it;
    one with none cannot be moved without Convex, so it is dropped from the set
    and the next publish deletes it, rather than leaving a key nothing can read
    in the person's blob for ever.
  */
  const relaySet = useMemo<StarSet | undefined>(() => {
    if (stars.state !== 'present' || !stars.relayBlob) return undefined
    return {
      topics: stars.relayBlob.topics.map((t) => t.id),
      people: [
        ...new Set(
          stars.relayBlob.people.flatMap((p) => {
            const key = p.pubkey ?? p.key
            return isPersonKey(key) ? [key] : []
          }),
        ),
      ],
    }
  }, [stars.state, stars.relayBlob])

  /**
   * The set as last settled, before this session's toggles. A relay that holds
   * no set is an empty one; a relay that has not answered is no set at all,
   * and nothing renders or publishes until it does.
   */
  const settledSet = relaySet ?? (stars.state === 'absent' ? NO_STARS : undefined)

  const effectiveSet = useMemo<StarSet | undefined>(() => {
    if (!settledSet) return undefined
    const kept = settledSet.people.filter((id) => pending.get(`${PERSON}${id}`) !== false)
    const have = new Set(kept)
    const added = [...pending.entries()]
      .filter(([key, starred]) => starred && key.startsWith(PERSON) && !have.has(key.slice(PERSON.length)))
      .map(([key]) => key.slice(PERSON.length))
    return { topics: settledSet.topics, people: [...kept, ...added] }
  }, [settledSet, pending])

  const entries = useMemo<StarredEntry[]>(() => {
    if (!hasRelay) return [...mockEntries].sort(byName)
    if (!effectiveSet) return []
    const personByKey = new Map((people ?? []).map((p) => [p.id, p]))
    const out: StarredEntry[] = []
    for (const dmId of effectiveSet.people) {
      const person = personByKey.get(dmId)
      if (!person) continue
      out.push({ id: `star_dm_${dmId}`, kind: 'dm', dmId, name: person.name, avatarSrc: person.avatarSrc })
    }
    return out.sort(byName)
  }, [mockEntries, effectiveSet, people])

  /*
    Publish the set the person owns, not the toggle that changed it.

    Driving this from the handlers would publish twice per toggle — once
    optimistically and once when the set caught up — and would miss a star that
    arrived from another tab. `starsToPublish` returns undefined for an
    unchanged set, so a re-render costs nothing, and once the relay is the
    source this republishes what it already holds, which is that same nothing.

    The guard SHR-6 had to keep, in its new form. It used to be
    `remote === undefined`: do not publish while the Convex query is in flight,
    because a briefly-empty set is a last-write-wins publish that makes the loss
    permanent. Now the relay's own answer is what is waited for — guarded
    inside `useStarsSync`, and here as `effectiveSet` being undefined.
    `people` is deliberately *not* waited for; it resolves rows, not membership
    of the set.

    An `absent` relay publishes only once the person has toggled something.
    `absent` includes a blob this version cannot read (`stars.ts`), and an empty
    set published over it on load would destroy it for nothing.

    Mock mode publishes nothing: there is no session and no relay, and a fixture
    is not the person's data.
  */
  const publishSet = stars.publish
  const untouchedAndAbsent = stars.state === 'absent' && pending.size === 0
  useEffect(() => {
    if (!hasRelay) return
    if (!effectiveSet || untouchedAndAbsent) return
    void publishSet({
      topics: effectiveSet.topics.map((id) => ({ id })),
      people: effectiveSet.people.map((key) => ({ key, pubkey: key })),
    })
  }, [effectiveSet, untouchedAndAbsent, publishSet])

  const isDmStarred = useCallback(
    (dmId: string) => {
      // The set, never `entries`: a star on somebody the directory has not
      // delivered yet is still a star, and reading it off the rows would let
      // the next toggle add a second one.
      if (!hasRelay) return mockEntries.some((e) => e.dmId === dmId)
      return effectiveSet?.people.includes(dmId) ?? false
    },
    [mockEntries, effectiveSet],
  )

  const toggleDm = useCallback(
    ({ dmId, name, avatarSrc }: StarDmInput) => {
      if (!hasRelay) {
        setMockEntries((prev) => {
          const exists = prev.some((e) => e.dmId === dmId)
          if (exists) return prev.filter((e) => e.dmId !== dmId)
          return [...prev, { id: `star_dm_${dmId}`, kind: 'dm', dmId, name, avatarSrc }]
        })
        return
      }
      const currentlyStarred = effectiveSet?.people.includes(dmId) ?? false
      setPending((prev) => new Map(prev).set(`${PERSON}${dmId}`, !currentlyStarred))
    },
    [effectiveSet],
  )

  // Not gated on `people`: that settles only for a signed-in viewer, and
  // hanging on it would leave the whole desk sidebar under a skeleton for
  // anyone it never settles for (DeskPage gates the column on this).
  const isLoading = hasRelay && effectiveSet === undefined

  return (
    <StarredContext.Provider value={{ entries, isDmStarred, toggleDm, isLoading }}>{children}</StarredContext.Provider>
  )
}

export function useStarred() {
  const ctx = useContext(StarredContext)
  if (!ctx) throw new Error('useStarred must be used inside StarredProvider')
  return ctx
}
