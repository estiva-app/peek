/**
 * Screener hover preview — more of the thread than the two-line snippet, read
 * from the relay (CON-14).
 *
 * Until CON-14 this was `screener.preview`, which read Convex `messages` by the
 * DM row's Convex id, and a file row got no card at all (FOL-34). Now each
 * half previews from what its fold already holds (`ScreenerValue.previewOf`):
 *
 * - **a DM row** — the screening message's thread, out of the channel store the
 *   DM dots read. No request: the store already has every message in the
 *   horizon.
 * - **a file row** — the screening comment the fold judged, plus its latest
 *   replies, which are the one thing not in hand. They are read by `#e` on
 *   hover (`threadsAsViewer`) and not before, so the Desk does not ask for a
 *   preview of every row it renders.
 */
import { useEffect, useMemo, useState } from 'react'
import { CURRENT_USER_NAME } from './currentUser'
import { formatReplyTimestamp } from './format'
import { hasConvex } from './store'
import { useMentionNames } from './people'
import { useForeignObjects } from './foreign'
import { validToken } from '@/auth/estivaId'
import { useScreener } from '@/api/internal/screener'

export interface ScreenerPreviewRow {
  authorName: string
  timestamp: string
  body: string
  kind: 'message' | 'reply'
}

/** How many replies the card shows under the message — `screener.preview`'s four. */
const PREVIEW_REPLIES = 4

type Said = { by: string; at: number; body: string; kind: ScreenerPreviewRow['kind'] }

/** A file row's replies, as read on hover: `undefined` until the read settles. */
type FileReplies = { key: string; replies: Said[] }

/**
 * `undefined` = still loading; `[]` = nothing to show (or mock mode).
 *
 * A row that is no longer on screen (dismissed, read, snoozed) has no source and
 * shows nothing, rather than a card for a conversation the Screener has let go.
 */
export function useScreenerPreview(itemId: string | null): ScreenerPreviewRow[] | undefined {
  const { previewOf } = useScreener()
  const { threads } = useForeignObjects()
  const names = useMentionNames()
  const source = itemId ? previewOf(itemId) : undefined

  const fileAddress = source?.kind === 'file' ? source.address : undefined
  const fileCommentId = source?.kind === 'file' ? source.comment.id : undefined
  const fileKey = fileAddress && fileCommentId ? `${fileAddress}\u0000${fileCommentId}` : undefined
  const [fileReplies, setFileReplies] = useState<FileReplies | null>(null)

  useEffect(() => {
    if (!fileAddress || !fileCommentId || !fileKey) return
    let live = true
    threads(fileAddress, [fileCommentId]).then(
      (answer) => {
        if (!live) return
        const replies = (answer.replies[fileCommentId] ?? []).slice(-PREVIEW_REPLIES)
        setFileReplies({
          key: fileKey,
          replies: replies.map((r) => ({ by: r.author, at: r.createdAt, body: r.body, kind: 'reply' as const })),
        })
      },
      // A refused read still shows the comment: the replies are the extra.
      () => live && setFileReplies({ key: fileKey, replies: [] }),
    )
    return () => {
      live = false
    }
  }, [fileAddress, fileCommentId, fileKey, threads])

  return useMemo(() => {
    if (!hasConvex || !itemId || !source) return []
    let said: Said[]
    if (source.kind === 'dm') {
      said = source.messages.map((m, i) => ({
        by: m.by,
        at: m.at,
        body: m.body,
        kind: i === 0 && m.root === m.id ? 'message' : 'reply',
      }))
    } else {
      if (!fileReplies || fileReplies.key !== fileKey) return undefined
      const { comment } = source
      said = [{ by: comment.author, at: comment.createdAt, body: comment.body, kind: 'message' }, ...fileReplies.replies]
    }
    const me = validToken()?.pubkey
    const nameOf = new Map((names ?? []).map((n) => [n.pubkey, n.name]))
    return said.map((s) => ({
      authorName: s.by === me ? CURRENT_USER_NAME : (nameOf.get(s.by) ?? 'Someone'),
      // The popover floats with no date dividers, so each row's label carries
      // its own day once it isn't today (same rule as thread reply cards).
      timestamp: formatReplyTimestamp(s.at * 1000),
      body: s.body,
      kind: s.kind,
    }))
  }, [itemId, source, fileReplies, fileKey, names])
}
