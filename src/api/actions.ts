/**
 * Write functions — the seam's mutation surface.
 *
 * Every function writes the local override layer (instant render — the
 * optimistic window; the full source of truth in mock mode) and, when a
 * deployment is configured, the corresponding Convex mutation. All writes
 * stamp CURRENT_USER_NAME (the Phase 3 identity switch point).
 */
import { useConvex, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useTopicMutations } from '@/api/internal/topicMutations'
import { useOpenWork } from '@/api/internal/openWork'
import { topicIdFromScreenerRowId, useScreener } from '@/api/internal/screener'
import { hasConvex, useDmRuntime } from './store'
import { validToken } from '@/auth/estivaId'
import { buildDeletion } from '@estiva-app/protocol'
import type { UnsignedEvent } from '@estiva-app/protocol'
import type { Id } from '../../convex/_generated/dataModel'
import { publishSigned, signViaEstivaId } from '@/nostr/bridge'
import { publishDmChannel } from '@/nostr/dms'
import { CURRENT_USER_NAME } from './currentUser'
import type { UploadedFile } from './uploads'
import type { ConversationData, FileAttachment, HighlightType, Huddle, ReactionData, ReplyData } from './types'

export interface SendMessagePayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /** Figma frame ids attached via the launcher's find flow. */
  /** Real uploaded files (already in Convex storage — Phase 5). */
  files?: UploadedFile[]
}

/** Uploaded descriptor → optimistic-render shape (image previews show at once
 *  via the local object URL until the server resolves the real storage URL). */
function toFileAttachment(f: UploadedFile): FileAttachment {
  return { storageId: f.storageId, previewUrl: f.previewUrl, name: f.name, contentType: f.contentType, size: f.size }
}

/** Descriptor → the mutation's `fileAttachments` arg shape. */
function toRemoteFiles(files: UploadedFile[] | undefined) {
  return files && files.length > 0
    ? files.map((f) => ({
        storageId: f.storageId as never,
        name: f.name,
        contentType: f.contentType,
        size: f.size,
        // The relay's copy, carried so `unsignedMessage` can name it in an
        // `imeta` (CON-12). Undefined where the blob upload did not happen,
        // which the outbox reads as "this file does not travel" rather than
        // guessing a URL the relay would refuse.
        sha256: f.sha256,
        mediaUrl: f.mediaUrl,
        thumbUrl: f.thumbUrl,
        dim: f.dim,
      }))
    : undefined
}

const nowTimestamp = (now = Date.now()) =>
  new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * Whether an edit reached the relay — PEE-24.
 *
 * The edit is the write where silence costs the most. Peek patches its own row
 * first, so a failed publish leaves the app looking correct and **every other
 * reader showing the old text**, with nothing anywhere saying so. That is the
 * shape SILENT-FAILURES.md exists for, and the edit walked straight into it:
 * three branches that could decline, all three `console.warn`, nothing on
 * screen.
 *
 * `published: true` also covers "there was nothing to publish" — a huddle, a
 * message that never reached the relay. Those are not failures and must not be
 * reported as any: a warning people learn to dismiss is worse than none. A DM
 * left that list with DMS-4: its messages travel, so its edits must too.
 */
export type EditOutcome = { published: true } | { published: false; reason: string }

/**
 * What came of a delete (Katerina, 2026-09-10: a delete should confirm itself).
 *
 * `kept: true` is the one outcome worth interrupting for: Peek hid the thing,
 * the relay refused the tombstone, and the row is back. Without a word for it
 * a message would reappear a second after it vanished and nothing would say
 * why — the same silence PEEK-170 removed for topics.
 *
 * `kept: false` covers "the relay accepted it" *and* "there was nothing to
 * ask" — a huddle, a message that never reached the relay, mock mode. Neither
 * is a failure, and neither may be reported as one. A DM message deleted since
 * DMS-4 is the first case: it has an event id, so a tombstone goes out for it
 * like any other, the `kind:5` taking its channel from its target.
 */
export type DeleteOutcome = { kept: boolean }

/**
 * A send whose relay mirror was refused.
 *
 * The send's own answer is Convex's and stays so (CON-10) — the row is written
 * and on every Peek screen, so the draft must not come back. But a message that
 * never reached the relay is invisible to every other app, cannot be mentioned
 * (the `[` menu offers only messages with an event id) and cannot be resolved
 * by pointer, and until now all of that was a `console.warn`. Fourteen topics
 * had their channel deleted on the relay in the two days after the Folder
 * delete shipped, and every message sent into them since went this way with
 * nothing on screen to say so. The reason is the relay's own words, or Estiva
 * ID's when it would not sign.
 */
export type MirrorRefusal = { what: 'message' | 'reply'; reason: string }

export function usePeekActions(
  options: { onMirrorRefused?: (refusal: MirrorRefusal) => void } = {},
) {
  const m = useTopicMutations()
  const openWork = useOpenWork()
  const screener = useScreener()
  // One-shot reads. `useQuery` is reactive and cannot be called mid-action.
  const convex = useConvex()
  const { setSentDmMessages } = useDmRuntime()
  // Convex double-writes (no-ops without a deployment): the optimistic local
  // copy renders instantly; the record shares its id via seedKey so the
  // reactive read dedupes when it catches up.
  const sendRemote = useMutation(api.messages.send)
  const recordMessagePublished = useMutation(api.nostr.outbox.recordMessagePublished)
  const recordReplyPublished = useMutation(api.nostr.outbox.recordReplyPublished)
  const recordReactionPublished = useMutation(api.nostr.outbox.recordReactionPublished)
  const recordResolutionPublished = useMutation(api.nostr.outbox.recordResolutionPublished)
  // Where the relay lives. A query rather than a build-time variable so the
  // bundle and the backend cannot disagree about it — see convex/nostr/config.ts.
  const relayConfig = useQuery(api.nostr.config.relayConfig)
  const editBodyRemote = useMutation(api.messages.editBody)
  const editFilesRemote = useMutation(api.messages.editFiles)
  const removeRemote = useMutation(api.messages.remove)
  const sendReplyRemote = useMutation(api.replies.send)
  const removeReplyRemote = useMutation(api.replies.remove)
  const setResolutionRemote = useMutation(api.messages.setResolution)
  const setHighlightRemote = useMutation(api.messages.setHighlight)
  const toggleReactionRemote = useMutation(api.messages.toggleReaction)
  const createHuddleRemote = useMutation(api.huddles.create)
  const removeHuddleRemote = useMutation(api.huddles.remove)
  const dismissScreenerRemote = useMutation(api.desk.dismissScreenerItem)
  const snoozeScreenerRemote = useMutation(api.desk.snoozeScreenerItem)
  const addToOpenWorkRemote = useMutation(api.desk.addToOpenWork)
  const addTopicsToOpenWorkRemote = useMutation(api.desk.addTopicsToOpenWork)
  const removeTopicFromOpenWorkRemote = useMutation(api.desk.removeTopicFromOpenWork)
  const removeDmFromOpenWorkRemote = useMutation(api.desk.removeDmFromOpenWork)

  /**
   * The token every relay write needs, or null with the reason said out loud.
   *
   * These checks used to be `usesEstivaId ? validToken() : null` followed by a
   * bare `return`, in five places. Silence there is indistinguishable from
   * success — the Convex row is written either way — so a session that
   * published nothing looked exactly like one that published everything, and
   * finding out required reading the relay by hand.
   *
   * It deliberately does NOT consult `usesEstivaId`. That is a snapshot taken
   * when the module first evaluated, and it goes stale in a way that disables
   * publishing for a whole page load: open the app while the stored token has
   * expired and it is `false`, after which PEEK-108's refresh timer renews the
   * token — reads recover, `validToken()` starts returning a live token again,
   * and every publish path stays gated on the stale `false`, silently.
   *
   * `validToken()` asked at call time is the real question, and it is the same
   * question `usesEstivaId` was a cached answer to.
   */
  const tokenForPublish = (what: string): { accessToken: string; pubkey: string } | null => {
    const token = validToken()
    if (!token) {
      console.warn(`[nostr] ${what} not published: no live Estiva ID token in this tab`)
      return null
    }
    return token
  }

  /**
   * Sign an unsigned event and put it on the relay, returning the id the relay
   * assigned — or null, with the reason logged.
   *
   * Never throws to the caller and never surfaces as a failed user action *by
   * itself*: the Convex row is written either way, and the relay is a mirror
   * rather than the source of truth. That was true when this lived in an action
   * and has to stay true now that it does not.
   *
   * ## `onFailure` — "A failed publish says nothing about which half refused"
   *
   * Named rather than numbered: that issue is **also** `PEE-25`, and so is the
   * link-marker ticket this file's neighbours already cite. Refs collide across
   * projects (SHI-4), so a bare number here would read as the wrong one.
   *
   * The reason used to go to `console.warn` and nowhere else. For most kinds
   * that is right; for an **edit** it is not, because a failed publish leaves
   * every other reader showing the old text (PEE-24). So a caller that intends
   * to tell somebody can ask for the words.
   *
   * **It says which half refused**, and that is the whole point. Signing and
   * publishing fail for unrelated reasons — a credential that Estiva ID will
   * not sign with, versus a relay that will not take the event — and a message
   * that says only "not published" sends people to look at the wrong one. That
   * cost two days on PEE-22: the toast said the relay declined, which was true
   * and told nobody anything they could act on.
   *
   * A throw from `signViaEstivaId` is caught here rather than left to the
   * caller, so that "could not sign" is reported in the same shape as "the
   * relay refused" instead of arriving as an unrelated exception.
   */
  const signAndPublish = async (
    unsigned: UnsignedEvent,
    token: { accessToken: string; pubkey: string },
    onFailure?: (reason: string) => void,
  ): Promise<string | null> => {
    const relay = relayConfig?.relayUrl
    if (!relay) {
      const reason = 'publishing is off in this deployment'
      console.warn(
        `[nostr] kind:${unsigned.kind} not published: no relay origin ` +
          `(publishing is off, or the config query has not resolved yet)`,
      )
      onFailure?.(reason)
      return null
    }

    let signed: Awaited<ReturnType<typeof signViaEstivaId>>
    try {
      signed = await signViaEstivaId(unsigned, token.accessToken, token.pubkey)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[nostr] kind:${unsigned.kind} could not be signed:`, detail)
      // Named as the credential rather than the relay: /sign refusing is a
      // signed-in problem, and telling somebody the relay declined sends them
      // to check a service that never saw the event.
      onFailure?.(`Estiva ID would not sign it — ${detail}`)
      return null
    }

    const result = await publishSigned(relay, signed, token.accessToken, token.pubkey)
    if (!result.ok) {
      console.warn(`[nostr] kind:${unsigned.kind} publish failed:`, result.reason)
      onFailure?.(`the relay refused it — ${result.reason}`)
      return null
    }
    return result.eventId ?? null
  }

  /**
   * Put a resolve/reopen on the relay (PEEK-128).
   *
   * Takes the assertion id the mutation returned rather than looking one up:
   * the row is append-only, so "the latest assertion for this message" would be
   * a race the moment two people resolve at once.
   *
   * Same contract as every other kind here — the Convex row is already written,
   * this is the mirror, and a failure is a warning rather than a failed action.
   */
  const publishResolution = (assertion: Promise<Id<'resolutionAssertions'> | null>) => {
    void (async () => {
      const assertionId = await assertion
      if (!assertionId) {
        // Ordinary when nothing changed — reopening something already open
        // appends no assertion — but it is also what an unrecognised message
        // key looks like, so it is worth saying which happened.
        console.warn('[nostr] resolution not published: no assertion was appended')
        return
      }
      const token = tokenForPublish('resolution')
      if (!token) return
      const built = await convex.query(api.nostr.outbox.unsignedResolution, { assertionId })
      if (!built.ok) {
        // Ordinary cases live here too — an unpublished target, a container
        // with no channel yet, a huddle — so this is a debug line, not a
        // failure.
        console.warn('[nostr] resolution not published:', built.reason)
        return
      }
      const eventId = await signAndPublish(built.unsigned, token)
      if (eventId) await recordResolutionPublished({ assertionId, nostrEventId: eventId })
    })().catch((error) => console.warn('[nostr] resolution publish failed:', error))
  }

  /**
   * Give this DM its channel before a message tries to hang off one — DMS-4.
   *
   * The first message to somebody new is the case: `messages.send` creates the
   * `dmConversations` row, and only then does `useEnsureDmChannel`'s reactive
   * query flip to `ok` and open the channel. The mirror below starts in the
   * same tick, so it would ask for an unsigned event while the row still has no
   * `channelUuid`, be refused — correctly, since an `h`-less `kind:9` is a
   * private message on nothing — and never be retried. The message would sit in
   * Convex, visible in Peek and nowhere else, for ever.
   *
   * So the order is made explicit here rather than left to two reactive things
   * racing. Every later message pays one query for it, which answers
   * `already has a channel` and publishes nothing: opening is keyed by the
   * participant set at the relay, so asking twice is not a second channel
   * (DMS-3). The hook stays as it is — it is what opens a channel for a
   * conversation nobody has spoken in yet.
   */
  const ensureDmChannel = async (dmKey: string): Promise<void> => {
    const relay = relayConfig?.relayUrl
    if (!relay) return
    // At call time, never a snapshot — `tokenForPublish` says why.
    const token = validToken()
    if (!token) return
    const result = await publishDmChannel(dmKey, relay, token, {
      unsignedDmOpen: (args) => convex.query(api.nostr.outbox.unsignedDmOpen, args as never),
      recordDmChannel: async (args) => {
        await convex.mutation(api.nostr.outbox.recordDmChannel, args as never)
      },
    })
    if (!result.ok && !result.expected) console.warn('[nostr] DM channel not opened:', result.reason)
  }

  /**
   * Write the message, then mirror it to the relay.
   *
   * **Returns whether CONVEX took it** — CON-10. That is the seam the draft
   * turns on, and it is deliberately not the relay's answer: a message Peek
   * stored has been sent, and a failed mirror leaves it visible to every Peek
   * reader. Keeping the draft there would put the text back in the composer
   * beside the message it already posted.
   *
   * The mutation failing is the case that loses work: nothing was written
   * anywhere, and without this the typed text was already gone.
   */
  const persistMessage = (
    parentKind: 'topic' | 'dm' | 'huddle',
    parentKey: string,
    msg: ConversationData,
    files?: UploadedFile[],
  ): Promise<boolean> => {
    if (!hasConvex) return Promise.resolve(true)
    return (async () => {
      let messageId: Id<'messages'>
      try {
        messageId = await sendRemote({
          parentKind,
          parentKey,
          seedKey: msg.id,
          body: msg.body,
          highlightType: msg.highlightType,
          resolved: msg.isResolved,
          resolutionMessage: msg.resolutionMessage,
          fileAttachments: toRemoteFiles(files),
        })
      } catch (error) {
        // Nothing was written anywhere. This is the only failure that means the
        // message was not sent, and the only one the composer should hold a
        // draft for.
        console.warn('[convex] message not saved:', error)
        return false
      }

      /*
        The relay mirror, and its outcome deliberately does NOT reach the
        caller.

        Signed and published from here, because this is the only place the
        bearer token exists — Convex does not hand it to scheduled work, and
        `/sign` will sign as nobody but that token's subject. Convex builds the
        unsigned event (it has the rows) and records the id afterwards (a fact,
        not a secret); the token never crosses the boundary.

        Kept fire-and-forget so a throw in here cannot be mistaken for a failed
        send: the message is already in Convex and already on every Peek
        reader's screen, so returning false would put the text back in the
        composer beside the message it just posted.
      */
      void (async () => {
        const token = tokenForPublish('message')
        if (!token) return
        // Before the event is built, because a DM with no channel yet has no
        // `h` to be built against (DMS-4).
        if (parentKind === 'dm') await ensureDmChannel(parentKey)
        const built = await convex.query(api.nostr.outbox.unsignedMessage, { messageId })
        if (!built.ok) {
          // Includes the ordinary cases — already published, a huddle, outside
          // the relay's window — so this is a debug line, not a failure.
          console.warn('[nostr] message not published:', built.reason)
          return
        }
        // A refusal from here on is one worth saying: the event was built and
        // the relay or the signer declined it.
        const eventId = await signAndPublish(built.unsigned, token, (reason) =>
          options.onMirrorRefused?.({ what: 'message', reason }),
        )
        if (eventId) await recordMessagePublished({ messageId, nostrEventId: eventId })
      })().catch((error) => console.warn('[nostr] message publish failed:', error))

      return true
    })()
  }

  /**
   * Tombstone on the relay whatever a remove mutation just destroyed.
   *
   * The rows are gone by the time this runs, which is why the mutation returns
   * the event ids rather than anything looking them up afterwards.
   *
   * **The first path to sign and publish entirely in the browser (PEEK-106).**
   * It went first because it needs nothing from Convex to build the event: a
   * kind:5 is just the target id, and the viewer's pubkey is in their own token.
   * Every other path needs an unsigned event assembled from rows, so this one
   * proves the seam without the extra machinery. The token now never leaves the
   * tab, so it can no longer appear in Convex's dashboard logs.
   */
  /** Undo an optimistic hide — the message is still there and still readable. */
  const unhide = (id: string) =>
    m.setDeletedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const publishDeletions = (
    removed: Promise<{ removed: boolean; nostrEventIds: string[] }>,
    /**
     * Put it back — for the path where Peek has NOT deleted anything (PEE-18).
     *
     * When the viewer is not the author the mutation leaves the rows alone and
     * hands back the target so the relay can decide. The row then goes only if
     * the relay accepts the kind:5, through the sync's `applyDeletions`. So the
     * optimistic hide is a *prediction* on that path, and a refusal has to undo
     * it — otherwise a message the relay kept would be invisible in this tab
     * until reload, which is the silent divergence the ticket is about.
     *
     * Not needed on the author path: the rows are already gone from Convex, and
     * a failed tombstone leaves a relay copy that the next sync cannot remove
     * either. That case is a warning, not a rollback.
     */
    restore?: () => void,
  ): Promise<DeleteOutcome> => {
    /* Returns rather than only restoring, so a caller can say what happened —
       the same shape `editBody` has. `kept: true` means the row came back. */
    return (async (): Promise<DeleteOutcome> => {
      const outcome = await removed
      const { nostrEventIds } = outcome
      if (nostrEventIds.length === 0) {
        // Nothing to ask and nothing deleted: the viewer had no claim the relay
        // could adjudicate, so the prediction was wrong.
        if (!outcome.removed) { restore?.(); return { kept: true } }
        return { kept: false }
      }
      const token = tokenForPublish('deletion')
      if (!token) {
        if (!outcome.removed) { restore?.(); return { kept: true } }
        return { kept: false }
      }
      // One kind:5 per target rather than one event with many `e` tags — that
      // is the shape Buzz accepts, and a rejected batch would lose every
      // tombstone in it instead of one.
      let accepted = 0
      for (const targetEventId of nostrEventIds) {
        const id = await signAndPublish(buildDeletion(token.pubkey, Date.now(), { targetEventId }), token)
        if (id) accepted += 1
      }
      // The relay adjudicated and said no. `signAndPublish` has already logged
      // its words.
      if (!outcome.removed && accepted === 0) { restore?.(); return { kept: true } }
      return { kept: false }
    })().catch((error) => {
      console.warn('[nostr] deletion publish failed:', error)
      restore?.()
      return { kept: true }
    })
  }

  const buildMessage = ({ text, resolution, highlightType, files }: SendMessagePayload): ConversationData => ({
    id: `sent_${Date.now()}`,
    authorName: CURRENT_USER_NAME,
    timestamp: nowTimestamp(),
    createdAtMs: Date.now(),
    body: text,
    highlightType,
    isResolved: resolution ? true : undefined,
    resolvedBy: resolution ? CURRENT_USER_NAME : undefined,
    resolutionMessage: resolution?.message || undefined,
    files: files && files.length > 0 ? files.map(toFileAttachment) : undefined,
  })

  /** Resolution sent with no text: resolve the last runtime-sent message. */
  const resolveLastSent = (msgs: ConversationData[], message: string): ConversationData[] => {
    if (msgs.length === 0) return msgs
    const updated = [...msgs]
    updated[updated.length - 1] = {
      ...updated[updated.length - 1],
      isResolved: true,
      resolvedBy: CURRENT_USER_NAME,
      resolutionMessage: message || undefined,
    }
    return updated
  }

  return {
    // ── Messages ──
    /** Resolves false only when nothing was written anywhere — CON-10. */
    sendTopicMessage(topicId: string, payload: SendMessagePayload): Promise<boolean> {
      if (payload.text || payload.files?.length) {
        const newMsg = buildMessage(payload)
        m.setSentMessages((prev) => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), newMsg] }))
        return persistMessage('topic', topicId, newMsg, payload.files)
      }
      if (payload.resolution) {
        const message = payload.resolution.message
        m.setSentMessages((prev) => ({ ...prev, [topicId]: resolveLastSent(prev[topicId] ?? [], message) }))
      }
      return Promise.resolve(true)
    },

    /** `dmId` is the partner's person key — the server resolves the pair (§2.4). */
    sendDmMessage(dmId: string, payload: SendMessagePayload): Promise<boolean> {
      if (payload.text || payload.files?.length) {
        const newMsg = buildMessage(payload)
        setSentDmMessages((prev) => ({ ...prev, [dmId]: [...(prev[dmId] ?? []), newMsg] }))
        return persistMessage('dm', dmId, newMsg, payload.files)
      }
      if (payload.resolution) {
        const message = payload.resolution.message
        setSentDmMessages((prev) => ({ ...prev, [dmId]: resolveLastSent(prev[dmId] ?? [], message) }))
      }
      return Promise.resolve(true)
    },

    /** Top-level message posted inside a huddle (V2 huddle main view). */
    sendHuddleMessage(huddleId: string, text: string) {
      if (!text) return
      const now = Date.now()
      const newMsg: ConversationData = {
        id: `hsent_${now}`,
        authorName: CURRENT_USER_NAME,
        timestamp: nowTimestamp(now),
        body: text,
      }
      m.setHuddleSentMessages((prev) => ({ ...prev, [huddleId]: [...(prev[huddleId] ?? []), newMsg] }))
      persistMessage('huddle', huddleId, newMsg)
    },

    deleteTopicMessage(topicId: string, messageId: string): Promise<DeleteOutcome> {
      m.setSentMessages((prev) => ({ ...prev, [topicId]: (prev[topicId] ?? []).filter((msg) => msg.id !== messageId) }))
      m.setDeletedIds((prev) => new Set([...prev, messageId]))
      if (!hasConvex) return Promise.resolve({ kept: false })
      return publishDeletions(removeRemote({ key: messageId }), () => unhide(messageId))
    },

    deleteDmMessage(dmId: string, messageId: string): Promise<DeleteOutcome> {
      setSentDmMessages((prev) => ({ ...prev, [dmId]: (prev[dmId] ?? []).filter((msg) => msg.id !== messageId) }))
      m.setDeletedIds((prev) => new Set([...prev, messageId]))
      if (!hasConvex) return Promise.resolve({ kept: false })
      return publishDeletions(removeRemote({ key: messageId }), () => unhide(messageId))
    },

    /** Body edit — id-keyed, applies to messages and replies alike
     *  (the Convex mutation resolves the key against both tables). */
    /**
     * Change what a message says, and **say it on the relay** — CON-8.
     *
     * This used to be a Convex patch and nothing else, so a human edit never
     * left Peek: the relay kept the original `kind:9` body and every other
     * reader — Ship's conversation view, the agent — showed stale text
     * indefinitely, with nothing announcing the divergence.
     *
     * The mutation writes the row where the viewer is the author, and the
     * publish happens here for the same reason every other publish does: the
     * browser holds the only Estiva ID token.
     *
     * **The publish is not conditional on the patch.** Where the viewer is not
     * the author the row deliberately does not change (see `editBody` in
     * `convex/messages.ts`), and the edit is exactly what asks the relay
     * whether it may — the text then arrives through the sync if it was
     * accepted.
     */
    editBody(id: string, body: string): Promise<EditOutcome> {
      m.setBodyOverrides((prev) => ({ ...prev, [id]: body }))
      if (!hasConvex) return Promise.resolve({ published: true })
      return (async (): Promise<EditOutcome> => {
        await editBodyRemote({ key: id, body })
        const token = tokenForPublish('edit')
        // `tokenForPublish` has already said which credential is missing, and
        // its absence is the loudest case of all: the row changed and the relay
        // will never hear about it.
        if (!token) return { published: false, reason: 'you are not signed in to the relay' }

        const built = await convex.query(api.nostr.outbox.unsignedEdit, { key: id, body })
        if (!built.ok) {
          console.warn('[nostr] edit not published:', built.reason)
          // A DM or an unpublished row was never going to travel — saying so
          // would train people to ignore the message that matters.
          return built.expected ? { published: true } : { published: false, reason: built.reason }
        }

        let refusal = 'it did not reach the relay'
        const eventId = await signAndPublish(built.unsigned, token, (reason) => {
          refusal = reason
        })
        return eventId ? { published: true } : { published: false, reason: refusal }
      })().catch((error) => {
        console.warn('[nostr] edit publish failed:', error)
        return { published: false, reason: error instanceof Error ? error.message : String(error) }
      })
    },

    /**
     * File-attachment edit — PEE-16. Id-keyed across messages and replies too.
     *
     * The whole list, never a delta: it is what the edit box holds, and the
     * mutation deletes the blobs behind whatever is no longer in it.
     */
    editFiles(id: string, files: FileAttachment[]) {
      m.setFileOverrides((prev) => ({ ...prev, [id]: files }))
      if (hasConvex)
        void editFilesRemote({
          key: id,
          /*
            A fixture's file has nothing behind it on either side, so it does
            not travel. A **relay-imported** one does — CON-12: it has no
            storage id and never will, but it has a sha256 and a media URL,
            and dropping it here would silently strip somebody else's
            attachment the moment its message was edited. Ship and Peek share
            an Estiva ID pubkey, so an imported message can genuinely be the
            viewer's own to edit; the author check would not have caught it.
          */
          files: files
            .filter((f) => f.storageId || f.mediaUrl)
            .map((f) => ({
              storageId: f.storageId as never,
              name: f.name,
              contentType: f.contentType,
              size: f.size,
              sha256: f.sha256,
              mediaUrl: f.mediaUrl,
              thumbUrl: f.thumbUrl,
            })),
        })
    },

    /** Body edit for a huddle's SEED conversation (drives the card preview). */
    editHuddleSeedBody(conversationId: string, body: string) {
      m.setHuddleBodyOverrides((prev) => ({ ...prev, [conversationId]: body }))
    },

    setHighlight(id: string, highlightType: HighlightType | undefined) {
      m.setHighlightOverrides((prev) => ({ ...prev, [id]: highlightType }))
      if (hasConvex) void setHighlightRemote({ key: id, highlightType })
    },

    /**
     * Cards keep computing the next aggregate array (instant, pixel-exact)
     * and pass the emoji the user toggled.
     *
     * **`prev === undefined` means mock mode, and nothing else.** It used to
     * also mark a reply reaction — "session-local, §2.7 is message-keyed" —
     * and PEE-12 removed the thing that was true of: `toggleReaction` resolves
     * a reply key, `replies.list` folds the rows back, and `mergeReply` layers
     * them exactly as a message's. Every piece of the persistence path was
     * built; the click never reached it, because `ThreadPanel` dropped the two
     * arguments that decide this branch. So a reply reaction rendered, never
     * left the browser, and was gone on reload — and no reader in Ship ever
     * saw one. Both reply call sites pass `prev` and `emoji` now.
     *
     * Mock mode: the full array is the override (source of truth).
     * Convex mode: the server aggregate stays the source of truth — we record
     * a per-emoji pending toggle (the optimistic window) and clear it when the
     * mutation settles, by which point the reactive query reflects it. Never
     * masking the whole array keeps OTHER users' reactions flowing through
     * (the old full-array override hid them forever).
     */
    setReactions(id: string, reactions: ReactionData[], prev?: ReactionData[], emoji?: string) {
      if (!hasConvex || prev === undefined) {
        m.setReactionOverrides((prevMap) => ({ ...prevMap, [id]: reactions }))
        return
      }
      // Fallback for a caller that didn't pass the emoji: find the one whose
      // 'yours' flag flipped (only the current user's own reaction can change
      // client-side, so exactly one flips per call).
      const toggled =
        emoji ??
        [...new Set([...prev.map((r) => r.emoji), ...reactions.map((r) => r.emoji)])].find((e) => {
          const wasYours = prev.find((r) => r.emoji === e)?.owner === 'yours'
          const isYours = reactions.find((r) => r.emoji === e)?.owner === 'yours'
          return wasYours !== isYours
        })
      if (!toggled) return
      const wasYours = prev.find((r) => r.emoji === toggled)?.owner === 'yours'
      m.setPendingReactions((p) => ({ ...p, [id]: { ...p[id], [toggled]: wasYours ? 'remove' : 'add' } }))
      const clearPending = () =>
        m.setPendingReactions((p) => {
          const forId = { ...p[id] }
          delete forId[toggled]
          const next = { ...p }
          if (Object.keys(forId).length > 0) next[id] = forId
          else delete next[id]
          return next
        })
      void (async () => {
        // The mutation reports which half happened, and only for an Estiva ID
        // identity — custodial accounts are already covered by its scheduled job.
        const outcome = await toggleReactionRemote({ key: id, emoji: toggled })
        if (!outcome) return
        const token = tokenForPublish('reaction')
        if (!token) return
        if (outcome.action === 'added') {
          const built = await convex.query(api.nostr.outbox.unsignedReaction, {
            reactionId: outcome.reactionId,
          })
          if (!built.ok) {
            console.warn('[nostr] reaction not published:', built.reason)
            return
          }
          const eventId = await signAndPublish(built.unsigned, token)
          if (eventId) await recordReactionPublished({ reactionId: outcome.reactionId, nostrEventId: eventId })
        } else {
          // Retraction. The row is already gone, so the kind:5 is built from the
          // id the mutation handed back — nothing is left to look up.
          await signAndPublish(
            buildDeletion(token.pubkey, Date.now(), { targetEventId: outcome.nostrEventId }),
            token,
          )
        }
      })()
        .catch((error) => console.warn('[nostr] reaction publish failed:', error))
        .finally(clearPending)
    },

    // ── Resolution ──
    /** Card-level resolve/reopen (conv menu / resolve dialog). Replaces the
     *  whole override — a reply pointer from an earlier `→ msg` is dropped,
     *  matching the previous card behavior. */
    setResolution(id: string, resolved: boolean, resolvedBy?: string, message?: string) {
      m.setResolvedOverrides((prev) => ({ ...prev, [id]: { resolved, resolvedBy, message } }))
      if (hasConvex) publishResolution(setResolutionRemote({ key: id, resolved, resolutionMessage: message, dropReplyPointer: true }))
    },

    /** Thread-panel resolution edit: resolving keeps the reply pointer so the
     *  owning reply card can keep editing it inline; reopening clears all. */
    setThreadResolution(id: string, resolved: boolean, message?: string) {
      m.setResolvedOverrides((prev) => {
        const existing = prev[id]
        if (resolved) {
          return {
            ...prev,
            [id]: { resolved: true, resolvedBy: CURRENT_USER_NAME, message, resolvedByReplyId: existing?.resolvedByReplyId },
          }
        }
        return { ...prev, [id]: { resolved: false } }
      })
      if (hasConvex) publishResolution(setResolutionRemote({ key: id, resolved, resolutionMessage: resolved ? message : undefined }))
    },

    // ── Replies ──
    /** Send a reply; a `→ msg` resolution stamps resolvedByReplyId so the
     *  reply card can surface the resolution inline later. */
    sendReply(messageId: string, payload: SendMessagePayload): Promise<boolean> {
      const { text, resolution, highlightType, files } = payload
      let newReplyId: string | undefined
      let saved: Promise<boolean> = Promise.resolve(true)
      if (text || files?.length) {
        const now = Date.now()
        newReplyId = `reply_${now}`
        const newReply: ReplyData = {
          id: newReplyId,
          authorName: CURRENT_USER_NAME,
          timestamp: nowTimestamp(now),
          body: text,
          highlightType,
          createdAtMs: now,
          files: files && files.length > 0 ? files.map(toFileAttachment) : undefined,
        }
        m.setSentReplies((prev) => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), newReply] }))
        if (hasConvex) {
          saved = (async () => {
            let replyId: Id<'replies'>
            try {
              replyId = await sendReplyRemote({
                messageKey: messageId,
                seedKey: newReply.id,
                body: text,
                highlightType,
                fileAttachments: toRemoteFiles(files),
              })
            } catch (error) {
              // Nothing written. The only failure the composer holds a draft for.
              console.warn('[convex] reply not saved:', error)
              return false
            }

            /*
              The mirror, fire-and-forget for the same reason as a message's:
              the reply is already in Convex and on screen, so a relay failure
              is not an unsent reply and must not put the text back.

              As with messages: only the browser holds the Estiva ID token, so
              only the browser can publish for those identities. Custodial
              accounts are already handled by the mutation's scheduled job.
            */
            void (async () => {
              const token = tokenForPublish('reply')
              if (!token) return
              const built = await convex.query(api.nostr.outbox.unsignedReply, { replyId })
              if (!built.ok) {
                console.warn('[nostr] reply not published:', built.reason)
                return
              }
              const eventId = await signAndPublish(built.unsigned, token, (reason) =>
                options.onMirrorRefused?.({ what: 'reply', reason }),
              )
              if (eventId) await recordReplyPublished({ replyId, nostrEventId: eventId })
            })().catch((error) => console.warn('[nostr] reply publish failed:', error))

            return true
          })()
        }
      }
      if (resolution) {
        m.setResolvedOverrides((prev) => ({
          ...prev,
          [messageId]: {
            resolved: true,
            resolvedBy: CURRENT_USER_NAME,
            message: resolution.message,
            resolvedByReplyId: newReplyId,
          },
        }))
        if (hasConvex) {
          // Publishes like the other two resolution paths. Missing that here is
          // invisible from this side — the row still resolves, the card still
          // renders resolved, and only the relay is quietly short one assertion.
          publishResolution(
            setResolutionRemote({
              key: messageId,
              resolved: true,
              resolutionMessage: resolution.message,
              resolvedByReplyKey: newReplyId,
            }),
          )
        }
      }
      return saved
    },

    deleteReply(messageId: string, replyId: string): Promise<DeleteOutcome> {
      m.setSentReplies((prev) => ({ ...prev, [messageId]: (prev[messageId] ?? []).filter((r) => r.id !== replyId) }))
      // No `restore` here: a reply is hidden by dropping it from `sentReplies`,
      // which only ever held replies sent in this session. A persisted reply is
      // not hidden optimistically at all, so there is nothing to put back — it
      // simply stays until the sync removes it.
      if (!hasConvex) return Promise.resolve({ kept: false })
      return publishDeletions(removeReplyRemote({ key: replyId }))
    },

    // ── Huddles ──
    /** Inline (V1/V3) creation: people + first message. Returns the new id. */
    createHuddle(topicId: string, members: string[], firstMessageText: string): string {
      const newHuddleId = `h_new_${Date.now()}`
      const newHuddle: Huddle = {
        id: newHuddleId,
        topicId,
        members: [CURRENT_USER_NAME, ...members],
        state: 'active',
        lastActivity: 'Today',
        conversation: {
          id: `hc_new_${Date.now()}`,
          authorName: CURRENT_USER_NAME,
          timestamp: nowTimestamp(),
          createdAtMs: Date.now(),
          body: firstMessageText,
        },
      }
      m.setCreatedHuddles((prev) => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), newHuddle] }))
      if (hasConvex && newHuddle.conversation) {
        void createHuddleRemote({
          topicKey: topicId,
          seedKey: newHuddleId,
          memberNames: members,
          firstMessage: { seedKey: newHuddle.conversation.id, body: firstMessageText },
        })
      }
      return newHuddleId
    },

    /** V2 dialog creation: members only, no seed message. Returns the new id. */
    createEmptyHuddle(topicId: string, members: string[]): string {
      const newHuddleId = `h_new_${Date.now()}`
      const newHuddle: Huddle = {
        id: newHuddleId,
        topicId,
        members: [CURRENT_USER_NAME, ...members],
        state: 'active',
        lastActivity: 'Today',
      }
      m.setCreatedHuddles((prev) => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), newHuddle] }))
      if (hasConvex) {
        void createHuddleRemote({ topicKey: topicId, seedKey: newHuddleId, memberNames: members })
      }
      return newHuddleId
    },

    deleteHuddle(huddleId: string) {
      m.setDeletedHuddleIds((prev) => new Set([...prev, huddleId]))
      if (hasConvex) void removeHuddleRemote({ key: huddleId })
    },

    // ── Desk (pages keep their instant local hide; these persist it) ──
    /**
     * Dismiss — a watermark for a folded topic row, a deletion for a DM.
     *
     * The two halves keep different records because they keep different truths
     * (SHR-10). A folded row has no Convex id to delete: what "dismissed" means
     * is *ignore this conversation up to now*, which is exactly what the
     * deletion meant, since later traffic used to re-create the row. So it goes
     * into the person's decisions blob as an instant. DMs still have a row, and
     * still lose it.
     */
    dismissScreenerItem(id: string, nowMs: number = Date.now()) {
      const topicId = topicIdFromScreenerRowId(id)
      if (topicId) {
        screener.dismissTopic(topicId, nowMs)
        return
      }
      if (hasConvex) void dismissScreenerRemote({ id })
    },
    /**
     * "Open" → move the item into Open work.
     *
     * Takes the target as well as the row id since SHR-9: the Convex mutation
     * resolves the screener row to its target server-side, but the blob is the
     * list now and the client has to know what it is appending. The Screener row
     * already carries it (`desk.screenerList`), so nothing has to be looked up.
     */
    addScreenerToOpenWork(id: string, target: { kind: 'topic'; topicId: string } | { kind: 'dm'; dmId: string }) {
      if (target.kind === 'dm') openWork.addDm(target.dmId)
      else openWork.addTopics([target.topicId])
      if (!hasConvex) return
      const foldedTopic = topicIdFromScreenerRowId(id)
      if (foldedTopic) {
        // A folded row names no Convex screener item, so `addToOpenWork` — which
        // resolves the target *from* that row — has nothing to resolve. It still
        // has to write `deskOpenWork`: SHR-9 kept that table dual-written on
        // purpose, and it is what `watchableChannels` and the DM half's PEE-6
        // check still read. Dropping the write here would have left the row in
        // the blob and nowhere else, which looks exactly like a working Open
        // button until something reads Convex.
        void addTopicsToOpenWorkRemote({ topicKeys: [foldedTopic] })
        return
      }
      void addToOpenWorkRemote({ screenerItemId: id })
    },
    /** "Later" — the item reappears after `untilMs` (an absolute timestamp);
     *  defaults to +24h server-side when omitted. */
    snoozeScreenerItem(id: string, untilMs?: number) {
      const topicId = topicIdFromScreenerRowId(id)
      if (topicId) {
        // The +24h default is server-side for DMs (`desk.snoozeScreenerItem`).
        // A folded row has no server to default it, so it is spelled here — the
        // same 24 hours, in the one place the blob is written from.
        screener.snoozeTopic(topicId, untilMs ?? Date.now() + 24 * 60 * 60 * 1000)
        return
      }
      if (hasConvex) void snoozeScreenerRemote({ id, until: untilMs })
    },
    /** Remove a DM from Open work. By the partner's person key since SHR-9 —
     *  the rows the blob renders carry synthetic ids, so there is no Convex row
     *  id on this side to pass. */
    removeDmFromOpenWork(dmId: string) {
      openWork.removeDm(dmId)
      if (hasConvex) void removeDmFromOpenWorkRemote({ dmKey: dmId })
    },
    /** Desk "+" picker + the topic menus: put topics straight into Open work.
     *  The session overlay renders instantly and is what gets published; the
     *  Convex row follows, and is still what `watchableChannels` and the
     *  Screener's de-duplication read. */
    addTopicsToOpenWork(topicIds: string[]) {
      if (topicIds.length === 0) return
      openWork.addTopics(topicIds)
      if (hasConvex) void addTopicsToOpenWorkRemote({ topicKeys: topicIds })
    },
    /** The topic-side menus and the Desk rows both remove a topic by id. */
    removeTopicFromOpenWork(topicId: string) {
      openWork.removeTopic(topicId)
      if (hasConvex) void removeTopicFromOpenWorkRemote({ topicKey: topicId })
    },
  }
}
