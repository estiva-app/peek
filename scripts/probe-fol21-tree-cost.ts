/**
 * Measure what the Folder tree spends on the relay, level by level (FOL-21).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json scripts/probe-fol21-tree-cost.ts
 *
 * Read-only. Runs the same `@estiva-app/interop` functions the column's hooks
 * run — `listFolders` (`useFolders`), `resolveFolderContents` +
 * `conversationsOf` (`useFolderContents` + `useConversationBadges`, an open
 * fold), `resolveForeignObject` + `conversationsOf` (`useForeignChildren` +
 * the children's badges, an expanded row) — through a `query` that counts
 * every `POST /query`, so the numbers are the wire's and not the code's
 * opinion of itself. The ticket's done-when says a Folder's second level
 * costs one relay query on expand and none before; this prints what it costs,
 * against production, for the Folders project's own Folder and the Ship
 * project inside it.
 *
 * The seam-level half of the measurement — that the hooks are not *asked*
 * before the fold or the row opens — is `FolderTree.test.tsx`.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import {
  conversationsOf,
  createPeopleCache,
  createProjectionCache,
  listFolders,
  resolveFolderContents,
  resolveForeignObject,
  type ProjectionCache,
  type QueryFn,
} from '@estiva-app/interop'

/**
 * `NO_CACHE=1` measures the path as it was before FOL-21, with no
 * `ProjectionCache` — the numbers that made the seam start passing one.
 */
const NO_CACHE = process.env.NO_CACHE === '1'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** The Folders project's Folder — a Ship project with issues, a bare file beside it. */
const FOLDER = process.env.FOLDER ?? '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'

async function token(): Promise<{ accessToken: string; pubkey: string }> {
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
let filtersSent = 0
function countingQuery(t: { accessToken: string; pubkey: string }): QueryFn {
  return async (filters) => {
    const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
    const body = JSON.stringify(filters)
    const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
    posts++
    filtersSent += filters.length
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

/** Run one step and report what it cost. */
async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  const before = { posts, filters: filtersSent, at: Date.now() }
  const result = await run()
  console.log(
    `${label}: ${posts - before.posts} POST(s), ${filtersSent - before.filters} filter(s), ${Date.now() - before.at} ms`,
  )
  return result
}

async function main() {
  const t = await token()
  const query = countingQuery(t)
  const people = createPeopleCache().viaRelay(query)
  // The seam's module-scope cache, as `src/nostr/foreign.ts` passes it.
  const manifests: ProjectionCache | undefined = NO_CACHE ? undefined : createProjectionCache()
  console.log(`identity ${t.pubkey.slice(0, 8)}… relay ${RELAY_URL} ${NO_CACHE ? '(no manifest cache)' : '(manifest cache, as shipped)'}`)

  // Level 0 — the column on a cold load: the Folders, folded. (The union dots
  // are FOL-18's batched read, measured by its own probe: 2 POSTs for all.)
  const folders = await step('folders (useFolders)', () => listFolders(query))
  console.log(`  ${folders.length} Folder(s); folded, so nothing else is read`)

  /*
    Levels 1 and 2 twice in one process. The first pass is a cold browser —
    every manifest and every profile fetched; the second is what the same
    person pays for the *next* fold or row, with interop's module-scope caches
    warm. Both are real: the cold one is the first Folder anybody opens after
    a reload, the warm one is every Folder after it.
  */
  for (const pass of ['cold', 'warm'] as const) {
    console.log(`\n— ${pass} —`)
    // Level 1 — one fold opens: the Folder's first level and its rows' dots.
    const contents = await step('first level (useFolderContents)', () =>
      resolveFolderContents(FOLDER, query, people, manifests),
    )
    const peers = contents.files.filter((f) => !f.parentRef || !contents.files.some((p) => p.address === f.parentRef))
    await step('  + row dots (useConversationBadges)', () => conversationsOf(peers, query, manifests))
    if (pass === 'cold') {
      console.log(`  ${contents.files.length} file(s), ${peers.length} peer row(s)`)
      for (const f of peers) {
        console.log(`    ${f.listsChildren ? '▸' : ' '} ${f.slots.title?.value ?? f.ref} [${f.appName}]`)
      }
    }

    // Level 2 — one row expands: its children, and their dots.
    const parent = peers.find((f) => f.listsChildren && f.naddr)
    if (!parent?.naddr) {
      console.log('no row with children in this Folder; second level not measured')
      continue
    }
    const resolved = await step(`second level (useForeignChildren: ${parent.slots.title?.value})`, () =>
      resolveForeignObject(parent.naddr as string, query, people, 0, manifests),
    )
    const children = resolved?.children ?? []
    await step('  + child dots (useConversationBadges)', () => conversationsOf(children, query, manifests))
    if (pass === 'cold') console.log(`  ${children.length} child row(s)`)
  }

  console.log(`\ntotal: ${posts} POST(s), ${filtersSent} filter(s)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
