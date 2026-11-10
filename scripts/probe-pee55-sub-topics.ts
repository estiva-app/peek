/**
 * Where a topic started inside another one is listed (PEE-55).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-pee55-sub-topics.ts [folder name] [parent title]
 *
 * Read-only, as the agent. For the Folder (default "QA") prints what its
 * `kind:30890` names, every `kind:30840` filed there that names a parent by
 * `a`, whether the state lists each one, and what `resolveFolderContents` —
 * the read the Folders view draws — returns for the parent's row.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createPeopleCache, createProjectionCache, listFolders, nestingOf, resolveFolderContents, type QueryFn } from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const folderName = process.argv[2] ?? 'QA'
const parentTitle = process.argv[3] ?? 'Switch probe B'

async function token(): Promise<{ accessToken: string; pubkey: string }> {
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

function relayQuery(t: { accessToken: string; pubkey: string }): QueryFn {
  return async (filters) => {
    const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
    const body = JSON.stringify(filters)
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) }, body })
    const text = await res.text()
    if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
    return JSON.parse(text) as SignedEvent[]
  }
}

const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

async function main() {
  const t = await token()
  const query = relayQuery(t)
  const folders = await listFolders(query)
  const folder = folders.find((f) => f.name === folderName)
  if (!folder) throw new Error(`no Folder named ${folderName}`)
  console.log(`Folder ${folder.id} ${JSON.stringify(folder.name)} state=${folder.hasState} addresses=${folder.addresses?.length ?? '?'}`)
  const listed = new Set(folder.addresses ?? [])

  const contents = await resolveFolderContents(folder.id, query, createPeopleCache().viaRelay(query), createProjectionCache())
  const parent = contents.files.find((f) => f.slots.title?.value === parentTitle)
  console.log(`resolveFolderContents: ${contents.files.length} file(s); parent ${parentTitle}: ${parent?.address ?? 'NOT FOUND'}`)
  if (parent) {
    const kids = nestingOf(contents.files).childrenOf(parent)
    console.log(`  children in the listing: ${kids.map((k) => JSON.stringify(k.slots.title?.value)).join(', ') || '(none)'}`)
  }
  const withParent = contents.files.filter((f) => f.parentRef)
  console.log(`  files with a parentRef: ${withParent.map((f) => `${JSON.stringify(f.slots.title?.value)} → ${f.parentRef}`).join('; ') || '(none)'}`)

  const bare = await query([{ kinds: [30840], '#h': [folder.id], limit: 500 }])
  const subs = bare.filter((e) => tag(e, 'a'))
  console.log(`\n30840 with h=${folder.id}: ${bare.length}; naming a parent by a: ${subs.length}`)
  for (const e of subs.sort((x, y) => y.created_at - x.created_at).slice(0, 15)) {
    const address = `30840:${e.pubkey}:${tag(e, 'd')}`
    const drawn = contents.files.find((f) => f.address === address)
    const inContents = !!drawn
    // The folded title (a rename is a 1851) when the listing resolved it; the root's tag otherwise.
    const title = drawn?.slots.title?.value ?? tag(e, 'title')
    console.log(`  ${new Date(e.created_at * 1000).toISOString()} ${JSON.stringify(title)} a=${tag(e, 'a')} state-lists=${listed.has(address)} contents=${inContents}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
