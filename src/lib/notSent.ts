import { refusalReason } from '@estiva-app/conversation'

/*
  The notes for a refusal the person can no longer see where it happened
  (OPT-7, OPT-8). Everywhere else the kit's box and cards say it, in
  `@estiva-app/conversation`'s words ("Not sent: <reason>. Your text is back in
  the box."); these say the same reason, `refusalReason`'s, and where what came
  back is (ONE-4, Miky 4 Nov: the "restored in <topic>" note stays only for
  when you have left that conversation, with the same reason). `reason` is the
  refusal as it came: the relay's words never reach a person.

  why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md
*/

/**
 * What a send refused after the person moved on says: why, and what came back
 * and where — only what did: a send of only a file brings back no text.
 *
 * `where` is where it went back ("Design review", "your reply to Ana", "your
 * conversation with Ana").
 */
export function notSentNote(where: string, reason: unknown, back: { text: boolean; files: boolean; filesLost: boolean }): string {
  const what = back.text && back.files ? 'text and files' : back.text ? 'text' : back.files ? 'files' : ''
  const lost = back.filesLost ? (what ? ', files not restored' : '; files not restored') : ''
  return `Not sent: ${refusalReason(reason)}${what ? ` — ${what} restored in ${where}` : ''}${lost}`
}

/**
 * What a refused edit or delete says when no card of the message is on screen
 * to say it (OPT-8; decided by Miky, 9 October): why, and where what came back
 * is — the message is back in its list, an edit's text back in its edit box —
 * since the answer can come after the person has moved on.
 */
export function notSavedNote(change: 'edit' | 'delete', where: string, reason: unknown): string {
  if (change === 'edit') return `Not saved: ${refusalReason(reason)} — text restored in its edit box in ${where}`
  return `Not deleted: ${refusalReason(reason)} — the message is back in ${where}`
}
