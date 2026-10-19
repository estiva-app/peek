/**
 * CON-11 on the file surface, read back from production through the app's
 * own read: for every bare file (`kind:30840`) the agent can see, what
 * `useFileMentions` would hand the file page's Activity — the same
 * `fileMentionsAsViewer` the hook calls, against the real relay. Read-only.
 *
 * Also counts every `kind:1111` carrying a file address as `a` and how many of
 * those the own-conversation rule keeps out, so "no mentions" is
 * distinguishable from "nothing carries the tag yet".
 *
 * Goes through Vite because `bridge.ts` reads `import.meta.env`:
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-con11-file-mentions.ts [<address>]
 */
import { addrToNaddr } from '@estiva-app/protocol'
import { queryRelay } from '@/nostr/bridge'
import { fileMentionsAsViewer, fileMentionsOf } from '@/nostr/fileMentions'
import { isCommentOn } from '@estiva-app/conversation'
import type { StoredToken } from '@/auth/estivaId'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const BARE_FILE = 30840

async function agentToken(): Promise<StoredToken> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ESTIVA_ID_CLIENT_ID ?? '',
      client_secret: process.env.ESTIVA_ID_CLIENT_SECRET ?? '',
    }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; expires_in?: number }
  return { accessToken: body.access_token, pubkey: body.pubkey, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
}

export default async function main() {
  const token = await agentToken()
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const files = await queryRelay(RELAY_URL, [{ kinds: [BARE_FILE], limit: 500 }], token.accessToken, token.pubkey)
  if (!files.ok) throw new Error(`kind:30840 read refused: ${files.reason}`)
  const tag = (e: { tags: string[][] }, name: string) => e.tags.find((t) => t[0] === name)?.[1]
  const addressOf = (e: { kind: number; pubkey: string; tags: string[][] }) => `${e.kind}:${e.pubkey}:${tag(e, 'd')}`
  const titleOf = new Map(files.events.map((e) => [addressOf(e), tag(e, 'title') ?? '?']))
  console.log(`${files.events.length} bare files on ${RELAY_URL} as ${token.pubkey.slice(0, 8)}…`)
  // `--list`: each file with the `nostr:naddr…` a comment elsewhere would name it by.
  if (process.argv.includes('--list')) {
    for (const [address, title] of titleOf) console.log(`  "${title}"  ${address}\n    nostr:${addrToNaddr(address)}`)
  }

  const addresses = only ? [only] : [...titleOf.keys()]
  const tagged = await queryRelay(RELAY_URL, [{ kinds: [1111], '#a': addresses, limit: 2000 }], token.accessToken, token.pubkey)
  if (!tagged.ok) throw new Error(`#a read refused: ${tagged.reason}`)
  let own = 0
  let mentionRows = 0
  for (const a of addresses) {
    const hits = tagged.events.filter((e) => e.tags.some((t) => t[0] === 'a' && t[1] === a))
    own += hits.filter((e) => isCommentOn(e, a)).length
    mentionRows += fileMentionsOf(hits, a).length
  }
  console.log(`${tagged.events.length} kind:1111 carry a file address as \`a\`: ${own} are the file's own comments, ${mentionRows} are mentions`)

  let mentioned = 0
  for (const address of addresses) {
    const mentions = await fileMentionsAsViewer(address, RELAY_URL, token)
    if (mentions.length === 0) continue
    mentioned += 1
    console.log(`\n"${titleOf.get(address) ?? address}" — Activity would carry ${mentions.length} mention(s):`)
    for (const m of mentions) {
      console.log(
        `  ${new Date(m.createdAt * 1000).toISOString().slice(0, 16)}  Mentioned in "${titleOf.get(m.saidIn) ?? m.saidIn}"  by ${m.author.slice(0, 8)}…  thread ${m.threadId.slice(0, 8)}…\n` +
          `    ${JSON.stringify(m.body.slice(0, 80))}`,
      )
    }
  }
  console.log(`\n${mentioned} file(s) with a mention from another file's conversation.`)
}
