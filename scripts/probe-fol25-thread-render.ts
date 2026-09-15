/**
 * Does `FilePage` get reply counts for a migrated file? — FOL-25.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-fol25-thread-render.ts [address]
 *
 * Read-only. Unlike `probe-fol19-file-threads.ts`, which re-types the `#e`
 * filter, this calls **the app's own** `resolveObjectAsViewer` and
 * `threadsAsViewer` — the two functions `FilePage` actually calls — and then
 * derives `replyCounts` exactly as the page does. A probe that rebuilds the
 * filter proves the relay answers; it cannot prove the page reads the answer,
 * and that distinction is the whole of this bug.
 */
import { resolveObjectAsViewer, threadsAsViewer } from '@/nostr/foreign'
import type { StoredToken } from '@/auth/estivaId'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const ADDRESS =
  process.argv[2] ??
  '30840:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:ccd28557-01ad-4546-a3b5-4705f4379ba7'

async function viewer(): Promise<StoredToken> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string; expires_in?: number }
  return {
    accessToken: body.access_token,
    pubkey: body.pubkey,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
}

async function main() {
  const token = await viewer()
  console.log(`identity ${token.pubkey.slice(0, 8)}…  address ${ADDRESS}`)

  const object = await resolveObjectAsViewer(ADDRESS, RELAY_URL, token)
  if (!object) throw new Error('resolveObjectAsViewer returned null — the page would show nothing')
  console.log(`resolved "${object.slots.title?.value}" in ${object.appName}`)
  console.log(`  object.ref      ${object.ref}`)
  console.log(`  object.address  ${object.address}`)
  console.log(`  comments (#a)   ${object.comments.length}`)

  // Exactly FilePage:112 — the reference is `file.address`, not the URL's.
  const rootIds = object.comments.map((c) => c.id)
  const threads = await threadsAsViewer(object.address ?? ADDRESS, rootIds, RELAY_URL, token)

  const rootCount = Object.keys(threads.roots).length
  const replyTotal = Object.values(threads.replies).reduce((n, r) => n + r.length, 0)
  console.log(`threadsAsViewer: ${rootCount} roots by id, ${replyTotal} replies under ${Object.keys(threads.replies).length} of them`)

  // FilePage:116 — what ForeignConversationView is handed.
  const replyCounts = Object.fromEntries(
    Object.entries(threads.replies).map(([id, replies]) => [id, replies.length]),
  )
  const withCount = rootIds.filter((id) => !!replyCounts[id]).length
  console.log(`rows that would draw a count: ${withCount} of ${rootIds.length}`)
  console.log(`messages the page can reach: ${object.comments.length + replyTotal}`)

  for (const id of rootIds) {
    const n = replyCounts[id] ?? 0
    const root = threads.roots[id]
    console.log(`  ${id.slice(0, 8)}  replies=${n}  rootRead=${root ? `kind:${root.kind}` : 'MISSING'}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
