/**
 * Read one file's conversation and its threads the way `FilePage` does — FOL-19.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json scripts/probe-fol19-file-threads.ts [address]
 *
 * Read-only: three `POST /query` in all. It resolves the address through the
 * owner's manifest exactly as the page does (`resolveForeignObject`), then makes
 * the page's `#e` read for every root, and prints the tags of what came back —
 * so whether a Ship reply carries an `a` (it must not, and the thread pane's
 * whole design rests on that) is read off production rather than assumed.
 *
 * The default address is the FOL-19 issue itself.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, referenceToPointer } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { resolveForeignObject, resolveManifest, commentKindsOf, createProjectionCache } from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const ADDRESS =
  process.argv[2] ??
  '30851:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:d68a8c78-5ec7-4652-b236-89ab57ac5b1e'

async function token(): Promise<{ accessToken: string; pubkey: string }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'client_credentials', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, accessToken: string): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

let posts = 0
function queryAs(t: { accessToken: string; pubkey: string }) {
  return async (filters: Record<string, unknown>[]): Promise<SignedEvent[]> => {
    const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
    const body = JSON.stringify(filters)
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
    posts++
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
      body,
    })
    const text = await res.text()
    if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

const tags = (e: SignedEvent) =>
  e.tags
    .filter((t) => ['a', 'A', 'e', 'E', 'k', 'K', 'p', 'P', 'h', 'ts'].includes(t[0]))
    .map((t) => `${t[0]}=${t[1].length > 20 ? t[1].slice(0, 12) + '…' : t[1]}${t[3] ? `(${t[3]})` : ''}`)
    .join(' ')

async function main() {
  const t = await token()
  const query = queryAs(t)
  const cache = createProjectionCache()
  console.log(`identity ${t.pubkey.slice(0, 8)}…  address ${ADDRESS}`)

  const pointer = referenceToPointer(ADDRESS)
  const object = await resolveForeignObject(ADDRESS, query)
  if (!object) throw new Error('unresolved')
  console.log(`resolved: "${object.slots.title?.value}" in ${object.appName}, folder ${object.folder}, parent ${object.parentRef ?? '—'}`)
  console.log(`comments (#a read): ${object.comments.length}`)

  const manifest = await resolveManifest(pointer, query, cache)
  const kinds = manifest ? commentKindsOf(manifest.manifest) : []
  console.log(`comment kinds off the manifest: ${JSON.stringify(kinds)}`)

  const ids = object.comments.map((c) => c.id)
  const events = ids.length
    ? await query([{ ids, limit: ids.length }, { kinds, '#e': ids, limit: 200 }])
    : []
  const roots = events.filter((e) => ids.includes(e.id))
  const replies = events.filter((e) => !ids.includes(e.id))
  console.log(`thread read: ${roots.length} roots by id, ${replies.length} replies by #e`)
  for (const r of roots) console.log(`  root  kind:${r.kind} ${r.id.slice(0, 8)} ${tags(r)}`)
  for (const r of replies) console.log(`  reply kind:${r.kind} ${r.id.slice(0, 8)} ${tags(r)}`)
  const repliesWithA = replies.filter((e) => e.tags.some((t) => t[0] === 'a')).length
  console.log(`replies carrying a lowercase a: ${repliesWithA} (the #a read would have shown these as comments)`)

  /*
    The Folder's whole stream, for the shape of *any* reply in it: whether a
    reply anybody wrote — Ship's kind:9 with `['e', root, '', 'reply']`, or a
    NIP-22 kind:1111 — carries a lowercase `a`. If none does, the `#a` read can
    never show one and the `#e` read is the only way to a thread.
  */
  if (object.folder) {
    const stream = await query([{ kinds, '#h': [object.folder], limit: 500 }])
    const withE = stream.filter((e) => e.tags.some((t) => t[0] === 'e'))
    const withEAndA = withE.filter((e) => e.tags.some((t) => t[0] === 'a'))
    console.log(`folder stream: ${stream.length} events, ${withE.length} carry an e tag, ${withEAndA.length} of those also an a`)
    for (const e of withE.slice(0, 5)) console.log(`  kind:${e.kind} ${e.id.slice(0, 8)} ${tags(e)}`)
  }
  console.log(`POST /query: ${posts}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
