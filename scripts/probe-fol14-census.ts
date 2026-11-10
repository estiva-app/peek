/**
 * FOL-14 on production, read-only: every bare-file topic (`kind:30840`) on the
 * relay, where it is (`h`), what it says it is under (`a`), who started it, how
 * many `kind:1111` its conversation holds, and whether the Folder's `30890`
 * lists it. This is the evidence the done-when asks for — a person started a
 * topic under a team and under a project — read from the relay rather than
 * from either app's UI.
 *
 * Writes nothing.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx scripts/probe-fol14-census.ts
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { createPeopleCache, createProjectionCache, KIND_BARE_FILE, resolveFolderContents, type QueryFn } from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
const KIND_FOLDER_STATE = 30890
const KIND_COMMENT = 1111

type Token = { accessToken: string; pubkey: string }

async function token(): Promise<Token> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`POST /token: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { access_token: string; pubkey: string }
  return { accessToken: body.access_token, pubkey: body.pubkey }
}

async function sign(unsigned: UnsignedEvent, t: Token): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${await res.text()}`)
  return (await res.json()) as SignedEvent[]
}

const tag = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are not set')
  const t = await token()
  const files = await query([{ kinds: [KIND_BARE_FILE], limit: 500 }], t)
  console.log(`${files.length} kind:30840 on ${RELAY_URL} (agent ${t.pubkey.slice(0, 8)}…)`)
  const folders = [...new Set(files.map((f) => tag(f, 'h')).filter((h): h is string => !!h))]
  const [states, comments, people] = await Promise.all([
    folders.length ? query([{ kinds: [KIND_FOLDER_STATE], '#d': folders, limit: 500 }], t) : [],
    query([{ kinds: [KIND_COMMENT], '#A': files.map((f) => `${f.kind}:${f.pubkey}:${tag(f, 'd')}`), limit: 2000 }], t),
    query([{ kinds: [0], authors: [...new Set(files.map((f) => f.pubkey))] }], t),
  ])
  const nameOf = new Map(people.map((p) => [p.pubkey, (JSON.parse(p.content || '{}') as { name?: string }).name ?? p.pubkey.slice(0, 8)]))
  const stateOf = new Map(states.map((s) => [tag(s, 'd'), s]))
  const parents = [...new Set(files.map((f) => tag(f, 'a')).filter((a): a is string => !!a))]
  const parentEvents = parents.length
    ? await query(
        parents.map((a) => {
          const [kind, pubkey, d] = a.split(':')
          return { kinds: [Number(kind)], authors: [pubkey], '#d': [d], limit: 1 }
        }),
        t,
      )
    : []
  const parentTitle = new Map(parentEvents.map((p) => [`${p.kind}:${p.pubkey}:${tag(p, 'd')}`, tag(p, 'title') ?? tag(p, 'name') ?? '?']))

  for (const f of files.sort((a, b) => a.created_at - b.created_at)) {
    const address = `${f.kind}:${f.pubkey}:${tag(f, 'd')}`
    const h = tag(f, 'h') ?? '-'
    const a = tag(f, 'a')
    const state = stateOf.get(h)
    const listed = state ? (state.tags.some((x) => x[0] === 'a' && x[1] === address) ? 'listed' : 'NOT listed') : 'no state'
    const n = comments.filter((c) => c.tags.some((x) => x[0] === 'A' && x[1] === address)).length
    console.log(
      `${new Date(f.created_at * 1000).toISOString().slice(0, 16)}  ${nameOf.get(f.pubkey)}  "${tag(f, 'title')}"\n` +
        `    h ${h}  ${listed}  1111×${n}\n` +
        `    ${a ? `under ${a.split(':')[0]} "${parentTitle.get(a)}" (${a.slice(-8)})` : 'under the team (no parent)'}`,
    )
  }

  // The tree's nesting, from the same seam read the tree makes: a topic whose
  // `parentRef` names a file in the same listing is hidden from the peers and
  // drawn under that file (`FolderContentsView`'s `peersOf` / `childrenOf`).
  const q: QueryFn = (filters) => query(filters as Record<string, unknown>[], t)
  const peopleCache = createPeopleCache().viaRelay(q)
  for (const f of files.filter((x) => tag(x, 'a'))) {
    const h = tag(f, 'h')!
    const address = `${f.kind}:${f.pubkey}:${tag(f, 'd')}`
    const listing = await resolveFolderContents(h, q, peopleCache, createProjectionCache())
    const row = listing.files.find((x) => x.address === address)
    const parentListed = listing.files.some((x) => x.address === row?.parentRef)
    console.log(
      `\ntree: "${tag(f, 'title')}" in ${h.slice(0, 8)}… (${listing.files.length} files, source ${listing.source})\n` +
        `    row ${row ? 'present' : 'MISSING'}, parentRef ${row?.parentRef === tag(f, 'a') ? 'matches its a' : `is ${row?.parentRef}`}, ` +
        `parent ${parentListed ? 'listed → drawn as its child, hidden from peers' : 'NOT listed → drawn as a peer'}`,
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
