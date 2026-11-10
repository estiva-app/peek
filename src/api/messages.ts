/**
 * The shapes a thread renders.
 *
 * This was the merged message and reply reads for a Convex topic, huddle and
 * DM — Convex rows with the optimistic override layers over them. DMs left for
 * the relay in REM-1 and topics and huddles went with Convex in FOL-23; what
 * is left are the two shapes `ThreadPanel` draws, which a file's and a DM's
 * conversation build from relay events (`useFileConversationView`).
 */
import type { ReactionData, ReplyData } from './types'

/**
 * One resolve or reopen, as the thread timeline renders it (PEEK-129).
 *
 * `trusted` is false for an assertion Peek will not let move its own state
 * (PEEK-128 decision 4). Such an event is still shown: hiding it would leave a
 * reader wondering why nothing happened when someone said it did.
 */
export interface ResolutionEvent {
  kind: 'resolved' | 'reopened'
  /** Display name of whoever asserted it; undefined if Peek has no user row. */
  by?: string
  byId?: string
  byAvatarUrl?: string
  /** When it happened, ms. */
  atMs?: number
  /** Optional rationale — Peek's resolution message. */
  message?: string
  /** Stable React key. Absent for a synthesized one. */
  key?: string
  trusted?: boolean
  /**
   * An optimistic event still on the client clock.
   *
   * `buildThreadRows` must never sort client-clock and server-clock items
   * together — mixing them let clock skew misplace a freshly sent reply until
   * its server copy arrived (upstream 152c25d).
   */
  pending?: boolean
}

/** A reply as rendered in a thread: static shape + runtime reactions. */
export interface ThreadReply extends ReplyData {
  reactions?: ReactionData[]
}
