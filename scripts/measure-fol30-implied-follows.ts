/**
 * How big are the two reads FOL-30's implied follows would need, on production?
 *   1. kinds:[1851] in the horizon — every field change the viewer can read;
 *      how many carry field=assignee, and how many name the viewer.
 *   2. kinds:[1111, 9] with #p = viewer — mentions of the viewer.
 * Read-only, as the agent. Run from ~/peek-fol30-work with the agent env sourced.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

async function token() {
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
async function query(filters: unknown[], t: { accessToken: string; pubkey: string }): Promise<SignedEvent[]> {
  const url = `${RELAY_URL.replace(/\/+$/, '')}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`POST /query: ${res.status} ${text.slice(0, 200)}`)
  const parsed = JSON.parse(text) as SignedEvent[] | { events: SignedEvent[] }
  return Array.isArray(parsed) ? parsed : parsed.events
}
const tag = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

const t = await token()
const since = Math.floor(Date.now() / 1000) - 90 * 24 * 3600
const changes = await query([{ kinds: [1851], since, limit: 5000 }], t)
const assignee = changes.filter((e) => tag(e, 'field') === 'assignee')
const mine = assignee.filter((e) => tag(e, 'value') === t.pubkey)
const authors = new Set(assignee.map((e) => tag(e, 'value')))
console.log(`kind:1851 in 90 days: ${changes.length}; field=assignee: ${assignee.length} (${authors.size} distinct assignees); assigned to me: ${mine.length}`)
const mentions = await query([{ kinds: [1111, 9], '#p': [t.pubkey], since, limit: 5000 }], t)
const files = new Set(mentions.map((e) => (e.kind === 1111 ? tag(e, 'A') : tag(e, 'h'))))
console.log(`kinds 1111/9 with #p me in 90 days: ${mentions.length} → ${files.size} distinct keys`)
