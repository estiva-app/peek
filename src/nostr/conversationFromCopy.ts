/**
 * A conversation as the copy on the device answers it (PEE-4): the same staged
 * read `readConversation` sends the relay, against the copy, so a conversation
 * the relay answered on this device before draws before the relay answers
 * again. Rejects when the copy has not seen every read it makes — the caller
 * then waits for the relay, as before there was a copy.
 *
 * Its own module, beside `conversationCatchUp`, so that a test standing in for
 * the relay's read does not count this one as a second.
 */
import type { StoredToken } from '@/auth/estivaId'
import { conversationWith, type ConversationContainer, type FileConversation } from './fileConversation'
import { readFrom } from './readFrom'
import { RelayReadError } from './relayRead'

export async function conversationFromCopy(
  container: ConversationContainer,
  rootIds: readonly string[],
  relayUrl: string,
  token: StoredToken,
): Promise<FileConversation> {
  return conversationWith(container, rootIds, async (filters) => {
    const result = await readFrom('copy', relayUrl, filters, token.accessToken, token.pubkey)
    if (!result.ok) throw new RelayReadError(result.reason ?? 'unknown')
    return result.events
  })
}
