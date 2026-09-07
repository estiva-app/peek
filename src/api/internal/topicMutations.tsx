import { createContext, useContext, useState, useMemo, useCallback, type ReactNode, type Dispatch, type SetStateAction } from 'react'
import { TOPIC_CONVERSATIONS, type ConversationData, type FileAttachment, type HighlightType, type ReactionData } from '@/data/topicData'
import type { Huddle } from '@/data/huddleData'
import type { ReplyData } from '@/data/replyData'

interface ResolvedOverride {
  resolved: boolean
  resolvedBy?: string
  message?: string
  /** When the resolution was triggered by a reply (compose `→ msg` from the thread panel),
   *  this holds that reply's id so we can surface and edit the resolution inline on that
   *  specific reply card. Undefined when the resolution came from the conv-level menu. */
  resolvedByReplyId?: string
}

/**
 * Holds runtime mutation state for topics. Lives at the app level so a topic's
 * sent messages, replies, resolutions, and other overrides survive when the
 * user navigates away (e.g. back to a DM via the huddle anchor) and returns.
 *
 * Permanent dual-role (Phase 2 close-out ruling): in mock mode (no Convex
 * deployment — tests, Storybook, demo instance) these layers are the full
 * mutation source of truth over the static mocks; in Convex mode every write
 * double-writes and the layers cover only the optimistic window until the
 * reactive queries catch up.
 */
interface TopicMutationsValue {
  sentMessages: Record<string, ConversationData[]>
  setSentMessages: Dispatch<SetStateAction<Record<string, ConversationData[]>>>
  deletedIds: Set<string>
  setDeletedIds: Dispatch<SetStateAction<Set<string>>>
  resolvedOverrides: Record<string, ResolvedOverride>
  setResolvedOverrides: Dispatch<SetStateAction<Record<string, ResolvedOverride>>>
  sentReplies: Record<string, ReplyData[]>
  setSentReplies: Dispatch<SetStateAction<Record<string, ReplyData[]>>>
  bodyOverrides: Record<string, string>
  setBodyOverrides: Dispatch<SetStateAction<Record<string, string>>>
  /** The uploaded files an edit left behind — PEE-16. Keyed like bodyOverrides,
   *  so one map covers messages and replies alike. An entry means "this is the
   *  whole list now", including the empty list when every file was removed. */
  fileOverrides: Record<string, FileAttachment[]>
  setFileOverrides: Dispatch<SetStateAction<Record<string, FileAttachment[]>>>
  highlightOverrides: Record<string, HighlightType | undefined>
  setHighlightOverrides: Dispatch<SetStateAction<Record<string, HighlightType | undefined>>>
  createdHuddles: Record<string, Huddle[]>
  setCreatedHuddles: Dispatch<SetStateAction<Record<string, Huddle[]>>>
  deletedHuddleIds: Set<string>
  setDeletedHuddleIds: Dispatch<SetStateAction<Set<string>>>
  huddleBodyOverrides: Record<string, string>
  setHuddleBodyOverrides: Dispatch<SetStateAction<Record<string, string>>>
  /** Top-level messages posted into a huddle from the V2 huddle main view, keyed by huddleId. */
  huddleSentMessages: Record<string, ConversationData[]>
  setHuddleSentMessages: Dispatch<SetStateAction<Record<string, ConversationData[]>>>
  reactionOverrides: Record<string, ReactionData[]>
  setReactionOverrides: Dispatch<SetStateAction<Record<string, ReactionData[]>>>
  /**
   * Convex-mode optimistic window for MESSAGE reactions, keyed by message id →
   * emoji → the direction the user toggled. Applied on top of the server
   * aggregate (never masking it wholesale) and cleared when the toggle
   * mutation settles — by then the reactive query reflects it, so others'
   * reactions keep flowing through. Mock mode and reply reactions use
   * `reactionOverrides` (full arrays) instead.
   */
  pendingReactions: Record<string, Record<string, 'add' | 'remove'>>
  setPendingReactions: Dispatch<SetStateAction<Record<string, Record<string, 'add' | 'remove'>>>>
  /**
   * Derived: a topic is resolved when every non-deleted conversation in it is resolved
   * AND it has at least one such conversation. Single source of truth for the
   * dashed-circle vs checkmark icon shown across the app (topic list, topic header,
   * Desk page, "Huddle in <topic>" anchor, "Promoted to <topic>" divider, etc.).
   */
  isTopicResolved: (topicId: string) => boolean
}

const TopicMutationsContext = createContext<TopicMutationsValue | null>(null)

export function TopicMutationsProvider({ children }: { children: ReactNode }) {
  const [sentMessages, setSentMessages] = useState<Record<string, ConversationData[]>>({})
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set())
  const [resolvedOverrides, setResolvedOverrides] = useState<Record<string, ResolvedOverride>>({})
  const [sentReplies, setSentReplies] = useState<Record<string, ReplyData[]>>({})
  const [bodyOverrides, setBodyOverrides] = useState<Record<string, string>>({})
  const [fileOverrides, setFileOverrides] = useState<Record<string, FileAttachment[]>>({})
  const [highlightOverrides, setHighlightOverrides] = useState<Record<string, HighlightType | undefined>>({})
  const [createdHuddles, setCreatedHuddles] = useState<Record<string, Huddle[]>>({})
  const [deletedHuddleIds, setDeletedHuddleIds] = useState<Set<string>>(new Set())
  const [huddleBodyOverrides, setHuddleBodyOverrides] = useState<Record<string, string>>({})
  const [huddleSentMessages, setHuddleSentMessages] = useState<Record<string, ConversationData[]>>({})
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, ReactionData[]>>({})
  const [pendingReactions, setPendingReactions] = useState<Record<string, Record<string, 'add' | 'remove'>>>({})

  const isTopicResolved = useCallback(
    (topicId: string): boolean => {
      const staticConvs = (TOPIC_CONVERSATIONS[topicId] ?? []).flatMap((g) => g.convs)
      const sent = sentMessages[topicId] ?? []
      const allConvs = [...staticConvs, ...sent].filter((c) => !deletedIds.has(c.id))
      if (allConvs.length === 0) return false
      return allConvs.every((c) => resolvedOverrides[c.id]?.resolved ?? c.isResolved ?? false)
    },
    [sentMessages, deletedIds, resolvedOverrides],
  )

  const value = useMemo<TopicMutationsValue>(
    () => ({
      sentMessages,
      setSentMessages,
      deletedIds,
      setDeletedIds,
      resolvedOverrides,
      setResolvedOverrides,
      sentReplies,
      setSentReplies,
      bodyOverrides,
      setBodyOverrides,
      fileOverrides,
      setFileOverrides,
      highlightOverrides,
      setHighlightOverrides,
      createdHuddles,
      setCreatedHuddles,
      deletedHuddleIds,
      setDeletedHuddleIds,
      huddleBodyOverrides,
      setHuddleBodyOverrides,
      huddleSentMessages,
      setHuddleSentMessages,
      reactionOverrides,
      setReactionOverrides,
      pendingReactions,
      setPendingReactions,
      isTopicResolved,
    }),
    [sentMessages, deletedIds, resolvedOverrides, sentReplies, bodyOverrides, fileOverrides, highlightOverrides, createdHuddles, deletedHuddleIds, huddleBodyOverrides, huddleSentMessages, reactionOverrides, pendingReactions, isTopicResolved],
  )

  return <TopicMutationsContext.Provider value={value}>{children}</TopicMutationsContext.Provider>
}

export function useTopicMutations(): TopicMutationsValue {
  const ctx = useContext(TopicMutationsContext)
  if (!ctx) throw new Error('useTopicMutations must be used within TopicMutationsProvider')
  return ctx
}
