import type { ForeignObject } from '@estiva-app/interop'
import type { StoredToken } from '@/auth/estivaId'
import { projectOwnFileAsViewer } from '@/nostr/foreign'
import { eventIdOf } from '@/nostr/fileConversation'
import { readConversation } from '@/nostr/conversationCatchUp'
import { planTopic, publishTopicAsViewer } from '@/nostr/startTopic'
import { conversationKey, conversationsFor } from './conversations'
import { forgetStartedFile, holdStartedFile } from './useForeignConversation'
import { holdStartedTopic, type TopicOutcome } from './pendingTopics'

export interface StartTopicArgs {
  folder: string
  title: string
  /** The address of the file it sits under, of any kind. */
  parent?: string
  hasState: boolean
  /** Given when a topic the relay refused is started again: the same `d`, so its draft comes back with it. Never one that was saved and deleted. */
  fileId?: string
  /** For Start's dialog, should the relay refuse it: the Folder's name and the file it was started under. */
  folderName?: string
  parentFile?: ForeignObject
}

/**
 * Start a topic and open it at once (PEE-6). The topic is planned, drawn —
 * its page's answer, an empty conversation, a row in its Folder — and handed
 * back before anything is written; the two writes run behind it, and a
 * message sent meanwhile waits for them (`useFileConversation`).
 *
 * Refused, everything drawn for it is taken back, and `pendingTopics` says so
 * once what was sent into it is back in its draft. Accepted, the relay's own
 * answers draw it from then on, the same object.
 */
export async function startTopicAsViewer(
  args: StartTopicArgs,
  relayUrl: string,
  token: StoredToken,
): Promise<{ ok: true; address: string; naddr: string } | { ok: false; reason: string }> {
  const planned = planTopic(args, token.pubkey)
  let file: ForeignObject | null
  try {
    file = await projectOwnFileAsViewer({ ...planned.event, id: await eventIdOf(planned.event), sig: '' }, relayUrl, token)
  } catch (error) {
    console.warn('[nostr] drawing a new topic failed:', error)
    file = null
  }
  // Not drawable ahead (its manifest could not be read): written first and opened after, as before PEE-6.
  if (!file) {
    const written = await publishTopicAsViewer(planned, args, relayUrl, token)
    return written.ok ? { ok: true, address: planned.address, naddr: planned.naddr } : { ok: false, reason: written.reason }
  }
  // Its Folder is its `h`, which is the team it was written in.
  const drawn = { ...file, address: planned.address, folder: file.folder ?? args.folder }
  const container = { kind: 'file' as const, address: planned.address, h: drawn.folder }
  const conversations = conversationsFor(relayUrl, token.pubkey)
  const key = conversationKey(container)
  // Nothing has been said in a topic nobody has written yet: its conversation is held empty, so a message sent now is drawn.
  const { value } = await readConversation(container, [], async () => [])
  conversations.replace(key, value, [], Date.now())
  await holdStartedFile(drawn)

  const settled: Promise<TopicOutcome> = publishTopicAsViewer(planned, args, relayUrl, token).catch((error: unknown) => ({
    ok: false as const,
    reason: (error as Error)?.message ?? 'The topic could not be written.',
  }))
  holdStartedTopic(
    {
      address: planned.address,
      naddr: planned.naddr,
      fileId: planned.fileId,
      title: args.title,
      folder: args.folder,
      folderName: args.folderName,
      hasState: args.hasState,
      parent: args.parentFile,
      file: drawn,
    },
    settled,
    () => {
      conversations.drop(key)
      void forgetStartedFile(planned.address)
    },
  )
  return { ok: true, address: planned.address, naddr: planned.naddr }
}
