import { useMarkDmRead } from '@/lib/useMarkRead'
import { useLastSelection } from '@/lib/lastSelection'
import { scrollToMessageWhenReady } from '@/lib/messageAnchor'
import { draftKeys } from '@/lib/drafts'
import { useState, useRef, useEffect, type ReactNode } from 'react'
import { Header } from '@/components/Header'
import { NewTopicBanner } from '@/components/NewTopicBanner'
import { EmptyState } from '@estiva-app/ui'
import { useStarred, useDmChannels, useDmVisibility, useOpenWorkDms } from '@/api'
import { useFileConversationView } from './useFileConversationView'

interface UseDmConversationViewArgs {
  dmId: string | null
  dmName?: string
  /** Override the default toggleDm-and-stay behavior (e.g. Desk wants to clear selection on unstar) */
  onToggleStarred?: () => void
  /**
   * Unused since REM-1. It gated each message's "new" marker, which came from
   * Convex rows; the relay read has none until read state is the blob (REM-5).
   */
  showUnreads?: boolean
  /**
   * Hide this DM from the viewer's sidebar (DMS-6). The page owns it because
   * hiding what you are looking at is followed by leaving it, and only the
   * page knows where to go. Absent on pages whose list this does not affect.
   */
  onHideDm?: () => void
}

interface ViewSlots {
  rightPanel: ReactNode
  threadPanel: ReactNode | undefined
  /** The thread to open when only a reply is new: `undefined` until judged (CON-34). */
  replyOnlyThread: string | null | undefined
  openThread: (id: string | null) => void
}

/**
 * A DM, read from and written to its channel on the relay — REM-1.
 *
 * A DM is a channel, and its conversation is the channel's `kind:9` talk, so it
 * is drawn by the view FOL-31 built for a file's conversation with a channel
 * container: the same cards, thread pane and composer, every write a relay
 * event and nothing on screen the relay does not hold. Until REM-1 this read
 * Convex rows the browser had imported from the relay, and wrote Convex first
 * and the relay after without waiting; DMS-7's duplicate rows broke one pair's
 * import, and a failed publish still reported a sent message.
 *
 * Attachments go to the blob store only, as every upload does.
 * Two things a DM had are dropped (Miky, 2026-09-23): the highlight, which
 * only Convex held and no DM message carries, and the promoted-huddle context.
 *
 * **Nothing comes from Convex since REM-3.** `dmId` is the partner's pubkey,
 * which channel the DM is comes from the relay's `39000`s (`useDmChannels`),
 * and a DM with no channel gets one on first open. The relay→Convex import
 * `useChannelSync` ran for a DM is gone with them: it fed the DM dots and the
 * Desk, which read the relay now.
 */
export function useDmConversationView({ dmId, dmName, onToggleStarred, onHideDm }: UseDmConversationViewArgs): ViewSlots {
  const [threadConvId, setThreadConvId] = useState<string | null>(null)

  /*
    Opening the DM also gives it a channel on the relay if it has none (DMS-3):
    a DM is a channel, so there is nowhere to send the first message until the
    relay has minted one. `ensureChannel` waits for the channel read, and is a
    no-op for a DM that already has one.
  */
  const { state: channelsState, channelOf, ensureChannel } = useDmChannels()
  useEffect(() => {
    if (dmId) ensureChannel(dmId)
  }, [dmId, ensureChannel])
  /*
    And brings it back if the viewer had hidden it — DMS-6.

    Opening a hidden DM is the unhide, because the relay has no other one:
    `open_dm` clears the caller's `hidden_at` on re-open, so `reopenDm`
    publishes the same `41010` again. Once per *selection*, not once per
    change of the hidden set: a DM hidden from its own header stays open for
    a moment while the set updates, and reacting to that would undo the hide
    the person just asked for. So a selection is "considered" once the relay
    has answered, and only a fresh selection of a hidden DM re-opens it.
  */
  const { state: visibilityState, isDmHidden, reopenDm } = useDmVisibility()
  const considered = useRef<string | null>(null)
  useEffect(() => {
    // Both answers, or "hidden" cannot be judged: the set names channels, and
    // which channel this DM is arrives separately.
    if (visibilityState !== 'present' || channelsState !== 'present') return
    if (considered.current === dmId) return
    considered.current = dmId
    if (dmId && isDmHidden(dmId)) void reopenDm(dmId)
  }, [dmId, visibilityState, channelsState, isDmHidden, reopenDm])

  /*
    Which channel this DM is. Keyed on the partner's pubkey (§2.4), and only
    ever a channel the relay listed for this viewer, so a viewer can only name
    a conversation they are in. Undefined until the relay has answered, or the
    `41010` above has; the conversation below starts the moment it has one.
  */
  const channelUuid = dmId ? channelOf(dmId) : undefined
  const { isDmStarred, toggleDm } = useStarred()
  // Open work from the DM's own menu, as a file has it from its page (Katerina, 30 October).
  const openWorkDms = useOpenWorkDms()

  const dm = useFileConversationView({
    container: dmId != null && channelUuid ? { kind: 'channel', h: channelUuid } : null,
    rootIds: NO_ROOTS,
    openThreadId: threadConvId ?? undefined,
    onOpenThread: setThreadConvId,
    title: dmName ? `DM · ${dmName}` : '',
    noteName: dmName ? `your conversation with ${dmName}` : 'this conversation',
    draftKey: dmId ? draftKeys.container(dmId) : undefined,
    empty: dmName ? <NewTopicBanner kind="dm" title={dmName} /> : undefined,
  })
  // The DM is read up to the newest top-level message seen on screen, which had its
  // dwell already (Katerina, 30 October), and keeps reading what arrives while it
  // is open (PEE-44); an open thread reads its replies, inside the view.
  useMarkDmRead(dmId, dm.seenAt, 0)

  /*
    A link to a DM message lands on it (PEE-36) — `ObjectPage`'s one-shot, the
    one the file page answers for a comment (FOL-36), keyed by this DM's
    channel. The message's thread opens, and the scroll waits for the thread
    pane to draw; the one-shot is consumed only once it is answered, so a link
    opened while the channel read is in flight is not lost to it.
  */
  const { pendingTopicMessage, setPendingTopicMessage } = useLastSelection()
  const pending = channelUuid && pendingTopicMessage?.folder === channelUuid ? pendingTopicMessage : null
  // Opened while rendering, not in an effect — React's "adjusting state when a
  // prop changes", so the thread pane draws in the same pass.
  if (pending && threadConvId !== pending.eventId) setThreadConvId(pending.eventId)
  const threadDrawn = dm.threadPanel !== undefined
  useEffect(() => {
    if (!pending || threadConvId !== pending.eventId || !threadDrawn) return
    setPendingTopicMessage(null)
    void scrollToMessageWhenReady(pending.reply ?? pending.eventId)
  }, [pending, threadConvId, threadDrawn, setPendingTopicMessage])

  if (dmId == null || !dmName) {
    return {
      // A page EmptyState fills and centres itself in the pane's column (UIG-42).
      rightPanel: <EmptyState message="No conversation selected" />,
      threadPanel: undefined,
      replyOnlyThread: undefined,
      openThread: setThreadConvId,
    }
  }

  // One Panel, its bar the package's: the messages scroll under it, the composer stays put.
  const rightPanel = (
    <Header
      name={dmName}
      isStarred={isDmStarred(dmId)}
      onToggleStarred={onToggleStarred ?? (() => toggleDm({ dmId, name: dmName }))}
      onHideDm={onHideDm}
      openWorkAction={openWorkDms ? (openWorkDms.has(dmId) ? 'remove' : 'add') : undefined}
      onToggleOpenWork={openWorkDms ? () => (openWorkDms.has(dmId) ? openWorkDms.remove(dmId) : openWorkDms.add(dmId)) : undefined}
      {...dm.conversationParts}
    />
  )

  return { rightPanel, threadPanel: dm.threadPanel, replyOnlyThread: dm.replyOnlyThread, openThread: setThreadConvId }
}

const NO_ROOTS: readonly string[] = []
