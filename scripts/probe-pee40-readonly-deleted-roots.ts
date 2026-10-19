/**
 * PEE-40, read back from production through the app's own reads: every file
 * with a comment deleted under its replies, which of the two file views it
 * gets (`useFileView`'s rule: Peek's own when its manifest declares `comment`
 * and it has a Folder, the read-only panes otherwise), and what the read-only
 * panes' thread read — `fileThreadsAsViewer` — draws for it beside what the
 * `#e` read alone, `threadsAsViewer`, drew before. Read-only.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-pee40-readonly-deleted-roots.ts [address-suffix]
 */
import { queryRelay } from '@/nostr/bridge'
import { resolveObjectAsViewer, threadsAsViewer } from '@/nostr/foreign'
import { fileThreadsAsViewer } from '@/nostr/fileConversation'
import type { StoredToken } from '@/auth/estivaId'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')

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
  const suffix = process.argv[2] ?? ''
  const token = await agentToken()

  // Every comment on a file, grouped by the file its `A` names, then kept only where its parent is gone.
  // Every page of them: Buzz clamps a filter at 1,000, and an old orphan is as hidden as a new one.
  const events: Awaited<ReturnType<typeof queryRelay>>['events'] = []
  const seen = new Set<string>()
  for (let until: number | undefined; ; ) {
    const page = await queryRelay(RELAY_URL, [{ kinds: [1111], limit: 1000, ...(until ? { until } : {}) }], token.accessToken, token.pubkey)
    if (!page.ok) throw new Error(`comment read refused: ${page.reason}`)
    const fresh = page.events.filter((e) => !seen.has(e.id))
    for (const e of fresh) seen.add(e.id)
    events.push(...fresh)
    if (page.events.length < 1000 || fresh.length === 0) break
    until = Math.min(...page.events.map((e) => e.created_at))
  }
  const comments = { events }
  const parents = new Map<string, Set<string>>()
  for (const e of comments.events) {
    const address = e.tags.find((t) => t[0] === 'A')?.[1]
    const es = e.tags.filter((t) => t[0] === 'e' && t[1])
    const parent = es.find((t) => t[3] === 'reply')?.[1] ?? (es.length === 1 ? es[0][1] : undefined)
    if (!address || !parent || !address.endsWith(suffix)) continue
    parents.set(address, (parents.get(address) ?? new Set()).add(parent))
  }
  const allParents = [...new Set([...parents.values()].flatMap((s) => [...s]))]
  const held = new Set<string>()
  for (let i = 0; i < allParents.length; i += 200) {
    const ids = allParents.slice(i, i + 200)
    const r = await queryRelay(RELAY_URL, [{ ids, limit: ids.length }], token.accessToken, token.pubkey)
    if (!r.ok) throw new Error(`parent read refused: ${r.reason}`)
    for (const e of r.events) held.add(e.id)
  }
  const withDeleted = [...parents].filter(([, ps]) => [...ps].some((p) => !held.has(p))).map(([a]) => a)
  console.log(`comments ${comments.events.length}, files with a deleted parent ${withDeleted.length}`)

  for (const address of withDeleted) {
    const found = await resolveObjectAsViewer(address, RELAY_URL, token)
    if (!found) {
      console.log(`…${address.slice(-12)} unresolved`)
      continue
    }
    const folder = found.folder
    const canComment = !!found.naddr && (found.actions ?? []).some((a) => a.id === 'comment')
    const view = canComment && folder ? 'own' : 'read-only'
    const rootIds = found.comments.map((c) => c.id)
    const before = await threadsAsViewer(address, rootIds, RELAY_URL, token)
    const after = await fileThreadsAsViewer(address, rootIds, RELAY_URL, token)
    const count = (t: typeof before) => Object.values(t.replies).flat().length
    console.log(
      `…${address.slice(-12)} "${found.slots.title?.value ?? ''}" view ${view} roots ${rootIds.length} replies before ${count(before)} after ${count(after)} stand-ins ${after.deleted?.length ?? 0}`,
    )
    for (const d of after.deleted ?? []) {
      console.log(`   deleted …${d.id.slice(-12)}: ${(after.replies[d.id] ?? []).map((r) => JSON.stringify(r.body.slice(0, 40))).join(', ')}`)
    }
  }
}
