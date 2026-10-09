/**
 * What a refused send says (OPT-7; decided by Miky, 7 and 9 October).
 *
 * The message is gone from the list and what was written is back in its
 * composer, so the note says what came back and where — and only what did:
 * a send of only a file, refused after the person moved on, brings back no
 * text. The relay's own words are left out — 429s and 5xx are retried before
 * this, so what remains is jargon ("invalid: …") — except the one reason that
 * changes what to do next: access is gone, and sending again would only fail
 * the same way.
 *
 * `where` is where it went back ("Design review", "your reply to Ana", "your
 * conversation with Ana"); `conversation` is what can no longer be posted in,
 * the topic or the DM, never a thread.
 */
export function notSentNote(
  where: string,
  conversation: string,
  reason: string,
  back: { text: boolean; files: boolean; filesLost: boolean },
): string {
  const what = back.text && back.files ? 'text and files' : back.text ? 'text' : back.files ? 'files' : ''
  const lost = back.filesLost ? (what ? ', files not restored' : '; files not restored') : ''
  if (lostAccess(reason)) return `Not sent — you can no longer post in ${conversation}${what ? `; ${what} restored` : ''}${lost}`
  return `Not sent${what ? ` — ${what} restored in ${where}` : ''}${lost}`
}

/** The relay's answer to a write from someone no longer in the channel, or no longer on the relay (buzz `ingest.rs`). */
const lostAccess = (reason: string) => /restricted: not a (channel|relay) member/.test(reason)
