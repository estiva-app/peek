/**
 * What a refused send says (OPT-7; decided by Miky, 7 and 9 October).
 *
 * The message is gone from the list and its text is back in its composer, so
 * the note says where. The relay's own words are left out — 429s and 5xx are
 * retried before this, so what remains is jargon ("invalid: …") — except the
 * one reason that changes what to do next: access is gone, and sending again
 * would only fail the same way.
 *
 * `where` is where the text went back ("Design review", "your reply to Ana",
 * "your conversation with Ana"); `conversation` is what can no longer be
 * posted in, the topic or the DM, never a thread.
 */
export function notSentNote(where: string, conversation: string, reason: string, filesLost: boolean): string {
  const files = filesLost ? ', files not restored' : ''
  if (lostAccess(reason)) return `Not sent — you can no longer post in ${conversation}; text restored${files}`
  return `Not sent — text restored in ${where}${files}`
}

/** The relay's answer to a write from someone no longer in the channel, or no longer on the relay (buzz `ingest.rs`). */
const lostAccess = (reason: string) => /restricted: not a (channel|relay) member/.test(reason)
