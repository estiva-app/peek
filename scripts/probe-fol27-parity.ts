/**
 * What production's bare-file conversations already carry that the file page
 * does not draw — FOL-27's relay half of the parity audit.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx --tsconfig tsconfig.app.json scripts/probe-fol27-parity.ts
 *
 * Read-only, about six `POST /query`. The agent cannot sign in to Peek, so the
 * signed-in rows of the audit are Miky's; what the agent *can* settle from
 * here is whether each missing affordance is a live gap on today's data or a
 * theoretical one:
 *
 *   - every `kind:30840` on the relay, and its `kind:1111` roots by `#a`
 *     (the read `resolveForeignObject` makes, capped at CONVERSATION_LIMIT);
 *   - the replies by `#e`, so a file's true message count is known;
 *   - what those comments carry that `CommentRow` never draws: `kind:40003`
 *     edits, `kind:7` reactions, `kind:5` deletions, `kind:9101` resolutions,
 *     `p` mentions, `imeta` attachments;
 *   - whether each team channel has a `kind:9` stream at all (the "general
 *     chat as a row" question).
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor, KIND } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'
import { CONVERSATION_LIMIT } from '@estiva-app/interop'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''
/** Buzz's ceiling per POST (`buzz-query-batching-contract`). */
const FILTERS_PER_POST = 128
const IDS_PER_FILTER = 100

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
function queryAs(t: { accessToken: string; pubkey: string }) {
  return async (filters: Record<string, unknown>[]): Promise<SignedEvent[]> => {
    const out: SignedEvent[] = []
    for (let i = 0; i < filters.length; i += FILTERS_PER_POST) {
      const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
      const body = JSON.stringify(filters.slice(i, i + FILTERS_PER_POST))
      const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
      posts++
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
        body,
      })
      const text = await res.text()
      if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text}`)
      out.push(...(JSON.parse(text) as SignedEvent[]))
    }
    return out
  }
}

const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]
const has = (e: SignedEvent, name: string) => e.tags.some((t) => t[0] === name)
const chunks = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
const byTargets = (kind: number, ids: string[]) =>
  chunks(ids, IDS_PER_FILTER).map((ids) => ({ kinds: [kind], '#e': ids, limit: 500 }))

async function main() {
  const t = await token()
  const query = queryAs(t)
  console.log(`identity ${t.pubkey.slice(0, 8)}…  relay ${RELAY_URL}`)

  // Every bare file, and every team channel's metadata for the general-chat question.
  const files = (await query([{ kinds: [30840], limit: 500 }])).filter((e) => tag(e, 'd'))
  const address = (e: SignedEvent) => `30840:${e.pubkey}:${tag(e, 'd')}`
  console.log(`\nkind:30840 bare files: ${files.length}`)

  // The page's read, per file: roots by #a.
  const roots = await query(files.map((f) => ({ kinds: [1111], '#a': [address(f)], limit: 500 })))
  const rootsOf = new Map<string, SignedEvent[]>()
  for (const r of roots) {
    const a = tag(r, 'a')
    if (!a) continue
    rootsOf.set(a, [...(rootsOf.get(a) ?? []), r])
  }
  const rootIds = [...new Set(roots.map((r) => r.id))]
  // Replies never carry a lowercase `a` (FOL-19), so they are reached by #e only.
  const replies = (await query(byTargets(1111, rootIds))).filter((e) => !rootIds.includes(e.id))
  const replyIds = replies.map((r) => r.id)
  const allIds = [...rootIds, ...replyIds]
  const messages = [...roots, ...replies]
  console.log(`kind:1111 roots by #a: ${rootIds.length}, replies by #e: ${replies.length}`)

  const perFile = files
    .map((f) => ({ title: tag(f, 'title') ?? tag(f, 'name') ?? tag(f, 'd')!.slice(0, 8), n: rootsOf.get(address(f))?.length ?? 0 }))
    .sort((a, b) => b.n - a.n)
  const over = perFile.filter((x) => x.n >= CONVERSATION_LIMIT)
  console.log(`largest file by roots: ${perFile.slice(0, 5).map((x) => `"${x.title}" ${x.n}`).join(', ')}`)
  console.log(`files at or over CONVERSATION_LIMIT (${CONVERSATION_LIMIT}): ${over.length} — "Show earlier" ${over.length ? 'is' : 'is not yet'} a live gap`)

  // What CommentRow never draws, counted on today's comments.
  const [edits, reactions, deletions] = await Promise.all([
    query(byTargets(KIND.MESSAGE_EDIT, allIds)),
    query(byTargets(7, allIds)),
    query(byTargets(5, allIds)),
  ])
  const resolutions = await query(byTargets(KIND.ASSERTION, allIds))
  const editedIds = new Set(edits.map((e) => tag(e, 'e')))
  console.log(`\non these ${allIds.length} messages:`)
  console.log(`  kind:${KIND.MESSAGE_EDIT} edits: ${edits.length} on ${editedIds.size} messages — the page shows the original text for each`)
  console.log(`  kind:7 reactions: ${reactions.length} — none drawn on the page`)
  console.log(`  kind:5 deletions: ${deletions.length} — honoured only if the relay hides the target`)
  console.log(`  kind:${KIND.ASSERTION} resolutions: ${resolutions.length} — no resolved state on the page`)
  console.log(`  with p (mention): ${messages.filter((e) => has(e, 'p')).length}`)
  console.log(`  with imeta (attachment): ${messages.filter((e) => has(e, 'imeta')).length}`)
  console.log(`  with q or a second a (reference): ${messages.filter((e) => has(e, 'q') || e.tags.filter((x) => x[0] === 'a').length > 1).length}`)
  const authors = new Set(messages.map((e) => e.pubkey))
  console.log(`  distinct authors: ${authors.size}`)

  // The team channels: does each have a kind:9 stream, i.e. a general chat with nowhere to be drawn?
  const teams = [...new Set(files.map((f) => tag(f, 'h')).filter((h): h is string => !!h))]
  const streams = await query(teams.map((h) => ({ kinds: [9], '#h': [h], limit: 500 })))
  console.log(`\nteam channels holding bare files: ${teams.length}`)
  for (const h of teams) {
    const n = streams.filter((e) => tag(e, 'h') === h).length
    console.log(`  ${h.slice(0, 8)}… kind:9 messages: ${n}${n >= 500 ? '+' : ''}`)
  }
  console.log(`\nPOST /query: ${posts}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
