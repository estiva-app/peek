/**
 * Write functions — the seam's mutation surface.
 *
 * Every function writes the local override layer (instant render — the
 * optimistic window; the full source of truth in mock mode) and, when a
 * deployment is configured, the corresponding Convex mutation. All writes
 * stamp CURRENT_USER_NAME (the Phase 3 identity switch point).
 */
import { useAction, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useTopicMutations } from '@/api/internal/topicMutations'
import { hasConvex, useDmRuntime, usesEstivaId } from './store'
import { validToken } from '@/auth/estivaId'
import { CURRENT_USER_NAME } from './currentUser'
import type { UploadedFile } from './uploads'
import type { ConversationData, FileAttachment, HighlightType, Huddle, ReactionData, ReplyData } from './types'

export interface SendMessagePayload {
  text: string
  resolution?: { message: string }
  highlightType?: HighlightType
  /** Figma frame ids attached via the launcher's find flow. */
  attachments?: string[]
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
    ? files.map((f) => ({ storageId: f.storageId as never, name: f.name, contentType: f.contentType, size: f.size }))
    : undefined
}

const nowTimestamp = (now = Date.now()) =>
  new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function usePeekActions() {
  const m = useTopicMutations()
  const { setSentDmMessages } = useDmRuntime()
  // Convex double-writes (no-ops without a deployment): the optimistic local
  // copy renders instantly; the record shares its id via seedKey so the
  // reactive read dedupes when it catches up.
  const sendRemote = useMutation(api.messages.send)
  const publishMessageAsAuthor = useAction(api.nostr.publish.publishMessageAsAuthor)
  const editBodyRemote = useMutation(api.messages.editBody)
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
  const removeOpenWorkRemote = useMutation(api.desk.removeOpenWorkItem)

  const persistMessage = (
    parentKind: 'topic' | 'dm' | 'huddle',
    parentKey: string,
    msg: ConversationData,
    files?: UploadedFile[],
  ) => {
    if (!hasConvex) return
    void (async () => {
      const messageId = await sendRemote({
        parentKind,
        parentKey,
        seedKey: msg.id,
        body: msg.body,
        highlightType: msg.highlightType,
        resolved: msg.isResolved,
        resolutionMessage: msg.resolutionMessage,
        attachments: msg.attachments,
        fileAttachments: toRemoteFiles(files),
      })

      // Estiva ID identities publish from here, because this is the only place
      // the bearer token exists — Convex does not hand it to scheduled work, and
      // `/sign` will sign as nobody but that token's subject. Custodial accounts
      // are already published by the mutation's scheduled job, so republishing
      // them here would duplicate.
      const token = usesEstivaId ? validToken() : null
      if (!token) return
      const result = await publishMessageAsAuthor({
        messageId,
        estivaAccessToken: token.accessToken,
      })
      // Never surfaced as a failed send: the row is written either way, and the
      // relay is a mirror rather than the source of truth.
      if (!result.ok) console.warn('[nostr] message publish failed:', result.reason)
    })().catch((error) => console.warn('[nostr] message publish failed:', error))
  }

  const buildMessage = ({ text, resolution, highlightType, attachments, files }: SendMessagePayload): ConversationData => ({
    id: `sent_${Date.now()}`,
    authorName: CURRENT_USER_NAME,
    timestamp: nowTimestamp(),
    createdAtMs: Date.now(),
    body: text,
    highlightType,
    isResolved: resolution ? true : undefined,
    resolvedBy: resolution ? CURRENT_USER_NAME : undefined,
    resolutionMessage: resolution?.message || undefined,
    attachments,
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
    sendTopicMessage(topicId: string, payload: SendMessagePayload) {
      if (payload.text || payload.attachments?.length || payload.files?.length) {
        const newMsg = buildMessage(payload)
        m.setSentMessages((prev) => ({ ...prev, [topicId]: [...(prev[topicId] ?? []), newMsg] }))
        persistMessage('topic', topicId, newMsg, payload.files)
      } else if (payload.resolution) {
        const message = payload.resolution.message
        m.setSentMessages((prev) => ({ ...prev, [topicId]: resolveLastSent(prev[topicId] ?? [], message) }))
      }
    },

    /** `dmId` is the partner's person key — the server resolves the pair (§2.4). */
    sendDmMessage(dmId: string, payload: SendMessagePayload) {
      if (payload.text || payload.attachments?.length || payload.files?.length) {
        const newMsg = buildMessage(payload)
        setSentDmMessages((prev) => ({ ...prev, [dmId]: [...(prev[dmId] ?? []), newMsg] }))
        persistMessage('dm', dmId, newMsg, payload.files)
      } else if (payload.resolution) {
        const message = payload.resolution.message
        setSentDmMessages((prev) => ({ ...prev, [dmId]: resolveLastSent(prev[dmId] ?? [], message) }))
      }
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

    deleteTopicMessage(topicId: string, messageId: string) {
      m.setSentMessages((prev) => ({ ...prev, [topicId]: (prev[topicId] ?? []).filter((msg) => msg.id !== messageId) }))
      m.setDeletedIds((prev) => new Set([...prev, messageId]))
      if (hasConvex) void removeRemote({ key: messageId })
    },

    deleteDmMessage(dmId: string, messageId: string) {
      setSentDmMessages((prev) => ({ ...prev, [dmId]: (prev[dmId] ?? []).filter((msg) => msg.id !== messageId) }))
      m.setDeletedIds((prev) => new Set([...prev, messageId]))
      if (hasConvex) void removeRemote({ key: messageId })
    },

    /** Body edit — id-keyed, applies to messages and replies alike
     *  (the Convex mutation resolves the key against both tables). */
    editBody(id: string, body: string) {
      m.setBodyOverrides((prev) => ({ ...prev, [id]: body }))
      if (hasConvex) void editBodyRemote({ key: id, body })
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
     * and pass the emoji the user toggled. `prev` is ALWAYS an array for
     * messages (even `[]` — the first-reaction case must still persist);
     * `prev === undefined` marks a reply reaction, which stays session-local
     * (§2.7 is message-keyed).
     *
     * Mock mode + replies: the full array is the override (source of truth).
     * Convex mode messages: the server aggregate stays the source of truth —
     * we record a per-emoji pending toggle (the optimistic window) and clear
     * it when the mutation settles, by which point the reactive query
     * reflects it. Never masking the whole array keeps OTHER users' reactions
     * flowing through (the old full-array override hid them forever).
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
      toggleReactionRemote({ key: id, emoji: toggled }).then(clearPending, clearPending)
    },

    // ── Resolution ──
    /** Card-level resolve/reopen (conv menu / resolve dialog). Replaces the
     *  whole override — a reply pointer from an earlier `→ msg` is dropped,
     *  matching the previous card behavior. */
    setResolution(id: string, resolved: boolean, resolvedBy?: string, message?: string) {
      m.setResolvedOverrides((prev) => ({ ...prev, [id]: { resolved, resolvedBy, message } }))
      if (hasConvex) void setResolutionRemote({ key: id, resolved, resolutionMessage: message, dropReplyPointer: true })
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
      if (hasConvex) void setResolutionRemote({ key: id, resolved, resolutionMessage: resolved ? message : undefined })
    },

    // ── Replies ──
    /** Send a reply; a `→ msg` resolution stamps resolvedByReplyId so the
     *  reply card can surface the resolution inline later. */
    sendReply(messageId: string, payload: SendMessagePayload) {
      const { text, resolution, highlightType, attachments, files } = payload
      let newReplyId: string | undefined
      if (text || attachments?.length || files?.length) {
        const now = Date.now()
        newReplyId = `reply_${now}`
        const newReply: ReplyData = {
          id: newReplyId,
          authorName: CURRENT_USER_NAME,
          timestamp: nowTimestamp(now),
          body: text,
          highlightType,
          createdAtMs: now,
          attachments,
          files: files && files.length > 0 ? files.map(toFileAttachment) : undefined,
        }
        m.setSentReplies((prev) => ({ ...prev, [messageId]: [...(prev[messageId] ?? []), newReply] }))
        if (hasConvex) {
          void sendReplyRemote({
            messageKey: messageId,
            seedKey: newReply.id,
            body: text,
            highlightType,
            attachments,
            fileAttachments: toRemoteFiles(files),
          })
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
          void setResolutionRemote({
            key: messageId,
            resolved: true,
            resolutionMessage: resolution.message,
            resolvedByReplyKey: newReplyId,
          })
        }
      }
    },

    deleteReply(messageId: string, replyId: string) {
      m.setSentReplies((prev) => ({ ...prev, [messageId]: (prev[messageId] ?? []).filter((r) => r.id !== replyId) }))
      if (hasConvex) void removeReplyRemote({ key: replyId })
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
    dismissScreenerItem(id: string) {
      if (hasConvex) void dismissScreenerRemote({ id })
    },
    /** "Open" → move the item into Open work. */
    addScreenerToOpenWork(id: string) {
      if (hasConvex) void addToOpenWorkRemote({ screenerItemId: id })
    },
    /** "Later" — the item reappears after `untilMs` (an absolute timestamp);
     *  defaults to +24h server-side when omitted. */
    snoozeScreenerItem(id: string, untilMs?: number) {
      if (hasConvex) void snoozeScreenerRemote({ id, until: untilMs })
    },
    removeOpenWorkItem(id: string) {
      if (hasConvex) void removeOpenWorkRemote({ id })
    },
  }
}
