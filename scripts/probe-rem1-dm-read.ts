/**
 * Read a person's DMs the way the DM view reads them since REM-1 — off the
 * relay, through `channelConversationAsViewer` — and set each beside the
 * Convex rows the view used to draw.
 *
 *   PEEK_TOKEN_FILE=/path/to/token.json node scripts/run-in-vite.mjs scripts/probe-rem1-dm-read.ts
 *
 * `PEEK_TOKEN_FILE` holds a signed-in tab's `sessionStorage['peek.estivaId.token']`
 * verbatim — keep it outside every repository. Nothing here writes: two Convex
 * queries (which channel each DM is, and its rows for the comparison) and
 * relay reads, as that person.
 *
 * What to look at:
 * - `relay` against `convex` per DM. The relay is the whole history (DMS-7
 *   put every Convex-only DM there), so it should be at least the Convex count;
 *   the pair DMS-7's duplicate rows broke is the one whose Convex count is off.
 * - Every attachment's `imeta`: its `size` and `m` must be what the blob
 *   store holds, or ingest would have refused it — see peek#333.
 */
import { readFileSync } from 'node:fs'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import { channelConversationAsViewer } from '../src/nostr/fileConversation'

const CONVEX_URL = process.env.CONVEX_URL ?? 'https://honorable-guineapig-592.eu-west-1.convex.cloud'
const RELAY = process.env.RELAY_URL ?? 'https://estiva.estiva.app'

export default async function main() {
  const file = process.env.PEEK_TOKEN_FILE
  if (!file) throw new Error('PEEK_TOKEN_FILE is required')
  const token = JSON.parse(readFileSync(file, 'utf8')) as { accessToken: string; pubkey: string; expiresAt?: number }
  if (token.expiresAt && token.expiresAt < Date.now()) throw new Error('the token has expired — copy a fresh one')

  const convex = new ConvexHttpClient(CONVEX_URL)
  convex.setAuth(token.accessToken)
  const channels = await convex.query(api.nostr.outbox.dmChannels, {})
  console.log(`as ${token.pubkey.slice(0, 8)}…  relay ${RELAY}  ${new Date().toISOString()}  DMs with a channel: ${channels.length}`)

  for (const { dmKey, channelUuid } of channels) {
    let line = `  dm ${dmKey.padEnd(34)} ${channelUuid}`
    try {
      const found = await channelConversationAsViewer(channelUuid, RELAY, token as never)
      const replies = Object.values(found.replies).flat()
      const rows = await convex.query(api.messages.list, { parentKind: 'dm', parentKey: dmKey }).catch((e: Error) => e)
      const convexCount = rows instanceof Error ? `error: ${rows.message.slice(0, 60)}` : String(rows.rows.length)
      line += `  relay=${found.roots.length} messages + ${replies.length} replies  convex=${convexCount}`
      console.log(line)
      for (const event of [...found.roots, ...replies]) {
        const files = found.edits[event.id]?.files ?? event.files
        for (const f of files) {
          console.log(`      ${event.id.slice(0, 12)}  ${f.contentType.padEnd(16)} size=${String(f.size).padEnd(9)} x=${f.sha256.slice(0, 12)}…  ${f.name}`)
        }
      }
    } catch (error) {
      console.log(`${line}  FAILED: ${(error as Error).message}`)
    }
  }
}
