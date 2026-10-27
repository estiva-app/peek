/**
 * Post one top-level message in a QA topic as QA-1 or QA-2, with the body exactly as given.
 *
 *   node scripts/run-in-vite.mjs scripts/post-as-qa.ts --as 2 --topic <30840 address> --body "…" [--edit <id>]
 *
 * Through Peek's own write path (`commentAsViewer`), as the switch fixture's seed is. What the composer cannot send:
 * a reference alone on its line stays a raw `nostr:` there, so it draws as a widget card rather than a chip —
 * `probe-live-apply.mjs --widgets` needs both. Prints the event id.
 */
import { commentAsViewer, editCommentAsViewer } from '@/nostr/fileConversation'
import { qaToken } from './seed-switch-fixture'

const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const QA_FOLDER = 'a78e60b1-a41f-48c9-bcb0-6ceacdee8c69'

export default async function main() {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? undefined : args[i + 1]
  }
  const who = option('as') === '1' ? 1 : 2
  const address = option('topic')
  const body = option('body')
  if (!address || !body) throw new Error('usage: post-as-qa.ts --as 1|2 --topic <address> --body "…"')
  // `--edit <id>`: an edit of that message to `body` instead, as another tab of the same person would make it (OPT-8).
  const target = option('edit')
  const container = { kind: 'file' as const, address, h: QA_FOLDER }
  const result = target
    ? // An edit lists the message's whole file set (§6.8); this script posts and edits words only, so the set is empty.
      await editCommentAsViewer({ container, targetEventId: target, body, files: [] }, RELAY_URL, await qaToken(who))
    : await commentAsViewer({ container, body }, RELAY_URL, await qaToken(who))
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  console.log(result.id)
}
