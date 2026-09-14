/**
 * List every Folder production's relay knows, with what each one holds (FOL-22).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-fol22-folders.ts
 *
 * Read-only. The same `listFolders` + `resolveFolderContents` the column runs,
 * printed as one line per Folder: id, name, whether the relay keeps state for
 * it, and the kinds of the files inside. The sort FOL-22 asks for is a sort of
 * *these* rows into the five team Folders, so this is the list to sort.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  createPeopleCache,
  createProjectionCache,
  listFolders,
  resolveFolderContents,
  type QueryFn,
} from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

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

function relayQuery(t: { accessToken: string; pubkey: string }): QueryFn {
  return async (filters) => {
    const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
    const body = JSON.stringify(filters)
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
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

async function main() {
  const t = await token()
  const query = relayQuery(t)
  const people = createPeopleCache().viaRelay(query)
  const manifests = createProjectionCache()
  const folders = await listFolders(query)
  console.log(`${folders.length} Folder(s) on ${RELAY_URL}\n`)
  for (const folder of folders) {
    let files = '?'
    try {
      const contents = await resolveFolderContents(folder.id, query, people, manifests)
      files = contents.files.map((f) => `${f.kind}${f.slots.title?.value ? `:${JSON.stringify(String(f.slots.title.value).slice(0, 40))}` : ''}`).join(', ') || '(empty)'
    } catch (e) {
      files = `error: ${(e as Error).message.slice(0, 80)}`
    }
    console.log(`${folder.id}  ${folder.hasState ? 'state' : 'bare '}  ${JSON.stringify(folder.name ?? '')}  →  ${files}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
