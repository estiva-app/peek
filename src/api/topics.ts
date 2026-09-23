/**
 * Topic reads + topic-level actions.
 *
 * Convex-backed when a deployment is configured; the mock-backed topicStore
 * serves everything otherwise (tests, Storybook, checkouts without a
 * deployment). Convex returns stable seedKeys as ids (demo-seed ids +
 * client-generated ids), so demo data joins exactly like the mocks. Topic
 * creation double-writes: optimistic local store entry + Convex mutation
 * sharing the same client-generated id; the merge dedupes when the reactive
 * query catches up.
 */
import { useCallback } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useTopicMutations } from '@/api/internal/topicMutations'
import { CURRENT_USER_NAME, useCurrentUser } from './currentUser'
import { useTopicStore } from '@/api/internal/topicStore'
import { hasConvex } from './store'
import { validToken } from '@/auth/estivaId'
import { deleteTopicChannel, publishTopicChannel, renameTopicChannel } from '@/nostr/topics'
import type { Topic } from './types'
import type { Person } from './types'
import { RELAY_URL } from '@/api/relayUrl'

/** All topics. `undefined` while the Convex query is loading. */
export function useTopics(): Topic[] | undefined {
  const { topics: localTopics, extraTopics, deletedTopicIds } = useTopicStore()
  const me = useCurrentUser()
  const remote = useQuery(api.topics.list, hasConvex ? {} : 'skip')
  if (!hasConvex) return localTopics
  if (remote === undefined || me === undefined) return undefined
  const mapped: Topic[] = remote.map((t) => {
    const folderId = (t as any).channelUuid ?? null
    return {
      id: t.id,
      title: t.title,
      isResolved: t.isResolved, // server-derived (§4.1); surfaced via useIsTopicResolved
      invitees: t.memberNames.length
        ? t.memberNames.map((n, i) => (t.memberIds[i] === me.id ? CURRENT_USER_NAME : n))
        : undefined,
      // channelUuid from the server maps to the client-visible Folder id
      folderId,
      reactionTargetsOmitted: t.reactionTargetsOmitted,
    }
  })
  const ids = new Set(mapped.map((t) => t.id))
  return [...mapped, ...extraTopics.filter((t) => !ids.has(t.id))].filter(
    (t) => !deletedTopicIds.has(t.id), // optimistic window until the remove lands
  )
}

export function useTopicLookup(): (topicId: string) => Topic | undefined {
  const topics = useTopics()
  return useCallback((topicId: string) => topics?.find((t) => t.id === topicId), [topics])
}

/**
 * Derived topic resolution — THE source of truth for the dashed-circle vs
 * checkmark icon everywhere (topic list, header, Desk, huddle anchor,
 * promotion divider). Function form so lists can call it per row.
 * Convex mode reads the server-derived value from topics.list (resolution
 * writes double-write, so the reactive query keeps it current); mock mode
 * keeps the override-layer computation.
 */
export function useIsTopicResolved(): (topicId: string) => boolean {
  const localIsResolved = useTopicMutations().isTopicResolved
  const topics = useTopics()
  return useCallback(
    (topicId: string) => {
      if (!hasConvex) return localIsResolved(topicId)
      return topics?.find((t) => t.id === topicId)?.isResolved ?? false
    },
    [localIsResolved, topics],
  )
}

/**
 * Is the viewer a member of this topic? Convex mode reads real topicMembers
 * (surfaced through invitees — the viewer maps to CURRENT_USER_NAME). Mock
 * data carries no membership, so everything counts as yours (demo parity).
 * Returns true while the list is loading so non-member UI never flashes.
 */
export function useIsTopicMember(): (topicId: string) => boolean {
  const topics = useTopics()
  return useCallback(
    (topicId: string) => {
      if (!hasConvex || topics === undefined) return true
      const t = topics.find((t) => t.id === topicId)
      return t?.invitees?.includes(CURRENT_USER_NAME) ?? false
    },
    [topics],
  )
}

/** Delete a topic with everything in it (messages, huddles, membership,
 *  desk rows) — the topic-row more-menu action (QA #2.8). */
/**
 * Delete a topic, and tell the relay so it is actually gone.
 *
 * Until PEEK-170 this removed the topic, its messages, replies, reactions and
 * huddles from Convex and published nothing. Create propagated as a kind:9007;
 * delete propagated nowhere. A conversation somebody deleted, believing it
 * gone, stayed readable to every admitted member indefinitely — 145 messages
 * across 37 channels on production, with zero deletion requests against any of
 * them, and the largest was one its owner had gone looking for and could not
 * find.
 *
 * Returns an outcome rather than nothing, because the two failures are ones a
 * person has to hear about:
 *
 *  - **not the owner** — Buzz allows only a channel's owner to delete it, so
 *    somebody else's topic goes from Peek and stays on the relay. A real limit,
 *    not an error.
 *  - **the relay never heard** — the rows are gone and the messages are not.
 *
 * Publishing is reported rather than enforced, matching every other write here:
 * the deletion already happened and a relay outage must not undo it. What
 * changes for this one is that saying nothing is not an option — silence here
 * means somebody believes a conversation is gone while it is still readable.
 */
export type DeleteTopicOutcome = { kind: 'warning'; message: string } | null

export function useDeleteTopic(): (topicId: string) => Promise<DeleteTopicOutcome> {
  const deleteLocal = useTopicStore().deleteTopicLocal
  const removeRemote = useMutation(api.topics.remove)
  const relayUrl = RELAY_URL
  return useCallback(
    async (topicId: string): Promise<DeleteTopicOutcome> => {
      deleteLocal(topicId)
      if (!hasConvex) return null

      let result: { removed: boolean; channelUuid?: string | null }
      try {
        result = await removeRemote({ topicKey: topicId })
      } catch (error) {
        return {
          kind: 'warning',
          message:
            error instanceof Error ? error.message : 'That topic did not delete everywhere.',
        }
      }
      // Nothing was there, or it was never published: nothing of it is readable
      // anywhere else, so there is nothing to tell the relay.
      if (!result.removed || !result.channelUuid) return null

      // `validToken()` at call time, never a snapshot — see `tokenForPublish`.
      const token = validToken()
      if (!token || !relayUrl) {
        return {
          kind: 'warning',
          message:
            'Deleted from Peek. The messages are still on the relay and readable by other apps — sign in to Estiva ID and delete it again to remove them.',
        }
      }

      let sent: { ok: boolean; reason?: string }
      try {
        sent = await deleteTopicChannel(result.channelUuid, relayUrl, token)
      } catch (error) {
        sent = { ok: false, reason: error instanceof Error ? error.message : undefined }
      }
      return sent.ok
        ? null
        : {
            kind: 'warning',
            message:
              `Deleted from Peek, but the relay still has it, so its messages remain readable to other apps. ${sent.reason ?? ''}`.trim(),
          }
    },
    [deleteLocal, relayUrl, removeRemote],
  )
}

/** Add people to a topic (the empty-topic banner's Invite members flow). */
export function useInviteToTopic(): (topicId: string, invitees: Person[]) => void {
  const addLocal = useTopicStore().addInviteesLocal
  const addRemote = useMutation(api.topics.addMembers)
  return useCallback(
    (topicId: string, invitees: Person[]) => {
      const names = invitees.map((p) => p.name)
      addLocal(topicId, names) // mock source of truth; inert overlay in Convex mode
      if (hasConvex) void addRemote({ topicKey: topicId, memberNames: names })
    },
    [addLocal, addRemote],
  )
}

/** Join a topic you're not a member of (the Join banner, QA #2.7). */
export function useJoinTopic(): (topicId: string) => void {
  const joinRemote = useMutation(api.topics.join)
  return useCallback(
    (topicId: string) => {
      if (hasConvex) void joinRemote({ topicKey: topicId })
    },
    [joinRemote],
  )
}

export interface CreateTopicFromDmInput {
  title: string
  dmId: string
  dmName: string
  invitees: Person[]
  seedMessageId: string
}

export interface CreateTopicFromDmResult {
  topicId: string
  huddleId: string
  promotedAt: string
}

/**
 * The channel-create sequence, shared by both topic-creation paths.
 *
 * Signed and published in the browser (PEEK-106): every event in the sequence
 * needs the creator's token, and this is the only place it exists.
 */
function usePublishTopicChannel() {
  const convex = useConvex()
  const relayUrl = RELAY_URL
  return useCallback(
    async (topicId: string) => {
      // Said out loud for the same reason as the publish paths in actions.ts:
      // a channel that is never created makes every later publish in that topic
      // refuse, one step removed from the cause.
      // `validToken()` at call time, never the `usesEstivaId` snapshot — see
      // `tokenForPublish` in actions.ts for why that constant goes stale.
      const token = validToken()
      if (!token) {
        console.warn('[nostr] channel not created: no live Estiva ID token in this tab')
        return
      }
      if (!relayUrl) return
      const result = await publishTopicChannel(topicId, relayUrl, token, {
        channelPlan: (args) => convex.query(api.nostr.outbox.channelPlan, args as never),
        recordChannel: async (args) => {
          await convex.mutation(api.nostr.outbox.recordChannel, args as never)
        },
      })
      if (!result.ok) console.warn('[nostr] topic channel publish failed:', result.reason)
    },
    [convex, relayUrl],
  )
}

/** Create a standalone topic (no huddle, no DM promotion). Returns its id. */
export function useCreateTopic(): (title: string, invitees: Person[]) => string {
  const createLocal = useTopicStore().createTopic
  const createRemote = useMutation(api.topics.create)
  const publishChannel = usePublishTopicChannel()
  return useCallback(
    (title: string, invitees: Person[]) => {
      const topicId = createLocal(title, invitees.map((p) => p.name))
      if (hasConvex) {
        void (async () => {
          const remoteTopicId = await createRemote({
            title,
            seedKey: topicId,
            inviteeNames: invitees.map((p) => p.name),
          })
          await publishChannel(remoteTopicId)
        })().catch((error) => console.warn('[nostr] topic creation publish failed:', error))
      }
      return topicId
    },
    [createLocal, createRemote, publishChannel],
  )
}

/** Promote a DM into the seed huddle of a freshly created topic. */
export function useCreateTopicFromDm(): (input: CreateTopicFromDmInput) => CreateTopicFromDmResult {
  const createLocal = useTopicStore().createTopicFromDm
  const createRemote = useMutation(api.topics.create)
  const createHuddleFromDmRemote = useMutation(api.huddles.createFromDm)
  const publishChannel = usePublishTopicChannel()
  return useCallback(
    (input: CreateTopicFromDmInput) => {
      const result = createLocal(input)
      if (hasConvex) {
        // Sequenced: the huddle resolves its topic by the shared seedKey,
        // so the topic must exist first.
        void (async () => {
          const remoteTopicId = await createRemote({
            title: input.title,
            seedKey: result.topicId,
            inviteeNames: input.invitees.map((p) => p.name),
          })
          await publishChannel(remoteTopicId)
          await createHuddleFromDmRemote({
            topicKey: result.topicId,
            seedKey: result.huddleId,
            originDmKey: String(input.dmId),
            seedMessageKey: input.seedMessageId,
            memberNames: [input.dmName],
          })
        })().catch((error) => console.warn('[nostr] topic promotion publish failed:', error))
      }
      return result
    },
    [createLocal, createRemote, createHuddleFromDmRemote, publishChannel],
  )
}

// ── Topic details (PEE-2) ───────────────────────────────────────────────────

/** Everything the details dialog shows. `undefined` while the query is in
 *  flight, `null` for a topic Convex has never heard of (mock mode). */
export function useTopicDetails(topicKey: string | undefined) {
  return useQuery(api.topics.details, hasConvex && topicKey ? { topicKey } : 'skip')
}

/** A topic's history, oldest first. */
export function useTopicActivity(topicKey: string | undefined) {
  return useQuery(api.topics.activity, hasConvex && topicKey ? { topicKey } : 'skip')
}

/**
 * What came of a rename.
 *
 * `null` is clean. The two failures are **not** the same thing and must not
 * look the same: an `error` means nothing changed, and a `warning` means the
 * topic *was* renamed here but the relay was not told, so other apps still see
 * the old name. Collapsing them showed a red message under a rename that had
 * plainly worked (Katerina, 2026-08-20).
 */
export type RenameOutcome = null | { kind: 'error' | 'warning'; message: string }

/**
 * Rename a topic, locally and then on the relay.
 *
 * Convex first so the new name is on screen at once, then the kind:9002 that
 * tells every other app.
 *
 * **The local rename is not undone when the relay refuses.** Reverting would
 * throw away something the person did and can see, to satisfy a service they
 * may not even be signed in to — and Peek is where they are. So the rename
 * stands and the disagreement is said out loud instead, which is the one thing
 * that must not be silent.
 */
export function useRenameTopic(): (topicKey: string, title: string) => Promise<RenameOutcome> {
  const renameRemote = useMutation(api.topics.rename)
  const relayUrl = RELAY_URL
  const renameLocal = useTopicStore().renameTopicLocal
  return useCallback(
    async (topicKey, title): Promise<RenameOutcome> => {
      renameLocal(topicKey, title)
      if (!hasConvex) return null

      let result: { renamed: boolean; title?: string; channelUuid?: string | null }
      try {
        result = await renameRemote({ topicKey, title })
      } catch (error) {
        // Convex refused, so nothing changed anywhere. This is the only real
        // error of the three.
        return {
          kind: 'error',
          message: error instanceof Error ? error.message : 'That rename did not go through.',
        }
      }
      if (!result.renamed) return null

      // `validToken()` at call time, never a snapshot — see `tokenForPublish`
      // in actions.ts for why that constant goes stale.
      const token = validToken()
      if (!token || !relayUrl) {
        return {
          kind: 'warning',
          message: 'Renamed in Peek. Sign in to Estiva ID so other apps see the new name too.',
        }
      }
      /*
       * Signing and publishing **throw** — `signViaEstivaId` raises on any
       * non-2xx from `/sign`, and an expired token is the ordinary way that
       * happens. Unhandled, that rejection escaped all the way past the caller
       * and left the Save button saying "Saving…" for ever, under a rename that
       * had already gone through (Katerina, 2026-08-20).
       *
       * It is a warning either way: the topic is renamed here, the relay simply
       * does not know.
       */
      let sent: { ok: boolean; reason?: string }
      try {
        sent = await renameTopicChannel(result.channelUuid ?? null, result.title ?? title, relayUrl, token)
      } catch (error) {
        sent = { ok: false, reason: error instanceof Error ? error.message : undefined }
      }
      return sent.ok
        ? null
        : {
            kind: 'warning',
            message: `Renamed in Peek, but not on the relay, so other apps still see the old name. ${sent.reason ?? ''}`.trim(),
          }
    },
    [relayUrl, renameLocal, renameRemote],
  )
}
