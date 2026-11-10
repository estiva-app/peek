import { useCallback, useEffect, useState } from 'react'
import type { FileMention } from '@/nostr/fileMentions'
import { mentionConversationAsViewer } from '@/nostr/fileMentions'
import type { FileConversation } from '@/nostr/fileConversation'
import { RelayReadError, classifyRelayFailure, isOutage } from '@/nostr/relayRead'
import { recordReadFailure } from '@/nostr/freshness'
import { useRefreshTriggers } from '@/lib/useRefreshTriggers'
import { useRelayViewer } from './foreign'
import { hasRelay } from './relayUrl'
import { heldBeside } from './conversations'

/** One answer: which mentions were asked about, and what they are now. */
export interface MentionConversation {
  /** The mention ids the read asked about. One asked about and absent from `conversation.roots` was edited away. */
  asked: ReadonlySet<string>
  conversation: FileConversation
}

/**
 * A file's mentions as they are now — what each row in its Activity draws
 * (PEE-48): every message's current text, reactions, replies and resolution,
 * read after `useFileMentions` has found them.
 *
 * ## Read on every showing
 *
 * The list of mentions is held on a return and asks nothing (OPT-3): the
 * file's own catch-up says when something new names it. What is done to a
 * mention is not news to this file — a reaction in a DM, a reply in a topic —
 * so these are read each time the Activity is drawn, the held answer drawn
 * first so the rows never blink, and again on focus, on becoming visible and
 * on the slow interval, as the mentions themselves are.
 *
 * The last answer stays while the next is read — after a new mention arrives,
 * too — so a row keeps its reactions until the newer read replaces them. A
 * refused read keeps it as well, for `useFileMentions`'s reason: a row whose
 * reactions vanish because a token expired says nobody reacted.
 */
export function useMentionConversation(
  address: string | null | undefined,
  mentions: readonly FileMention[],
): { current: MentionConversation | null; viewerPubkey: string | null } {
  const viewer = useRelayViewer()
  const file = address ?? null
  // What is asked about, as a value: these mentions of this file. A new mention, or one gone, asks again.
  const ids = mentions.map((m) => m.id).join(' ')
  const [resolved, setResolved] = useState<{ file: string; answer: MentionConversation }>()

  const load = useCallback(async (): Promise<{ file: string; ids: string; answer: MentionConversation } | null> => {
    if (!file || !ids) return null
    const v = viewer()
    if (!v) return null
    try {
      const conversation = await mentionConversationAsViewer(mentions, v.relayUrl, v.token)
      return { file, ids, answer: { asked: new Set(mentions.map((m) => m.id)), conversation } }
    } catch (error) {
      const kind = error instanceof RelayReadError ? error.kind : classifyRelayFailure((error as Error)?.message ?? '')
      if (isOutage(kind)) recordReadFailure(kind)
      console.warn('[nostr] mention conversation read failed:', error)
      return null
    }
    // `ids` names the mentions; the array itself is a new one whenever its owner draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, ids, viewer])

  const take = useCallback(
    (next: { file: string; ids: string; answer: MentionConversation } | null) => {
      // A slow read for other mentions, or another file, must not paint over these.
      if (!next || next.file !== file || next.ids !== ids) return
      held.set(next.file, next.answer)
      setResolved({ file: next.file, answer: next.answer })
    },
    [file, ids],
  )

  useEffect(() => {
    if (!hasRelay || !ids) return
    void load().then(take)
  }, [ids, load, take])

  useRefreshTriggers(() => void load().then(take), { enabled: hasRelay && !!ids })

  const current = file ? (resolved?.file === file ? resolved.answer : (held.get(file) ?? null)) : null
  return { current, viewerPubkey: viewer()?.token.pubkey ?? null }
}

/** The last answer for each file's mentions in this tab, drawn on a return. Emptied with the conversations. */
const held = heldBeside<MentionConversation>('mention-conversations')
