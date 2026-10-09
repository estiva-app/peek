/**
 * Post one top-level message in a QA topic as QA-1 or QA-2, with the body exactly as given.
 *
 *   node scripts/run-in-vite.mjs scripts/post-as-qa.ts --as 2 --topic <30840 address> --body "…"
 *
 * Through Peek's own write path (`commentAsViewer`), as the switch fixture's seed is. What the composer cannot send:
 * a reference alone on its line stays a raw `nostr:` there, so it draws as a widget card rather than a chip —
 * `probe-live-apply.mjs --widgets` needs both. Prints the event id.
 */
import { commentAsViewer } from '@/nostr/fileConversation'
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
  const result = await commentAsViewer({ container: { kind: 'file', address, h: QA_FOLDER }, body }, RELAY_URL, await qaToken(who))
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  console.log(result.id)
}
