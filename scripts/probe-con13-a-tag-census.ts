/**
 * CON-13 census: what a root's lowercase `a` means on production today.
 *
 * Reads every kind:1111 and every kind:9 the agent can see and sorts the roots
 * by shape: which app wrote it (`ts` tag = Ship, none = Peek), whether it has
 * an `A`, and whether each `a` is the `A` (NIP-22 parent = root), a body naddr
 * (a mention), or neither (a legacy comment anchor). Read-only.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   node scripts/run-in-vite.mjs scripts/probe-con13-a-tag-census.ts
 */
import { decodeNaddr, pointerToAddress } from '@estiva-app/protocol'
import { queryRelay } from '@/nostr/bridge'
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

type Ev = { id: string; kind: number; pubkey: string; created_at: number; content: string; tags: string[][] }
const tagsNamed = (e: Ev, n: string) => e.tags.filter((t) => t[0] === n && t[1]).map((t) => t[1])

function bodyAddresses(body: string): Set<string> {
  const out = new Set<string>()
  for (const m of body.matchAll(/nostr:(naddr1[0-9a-z]+)/g)) {
    try {
      out.add(pointerToAddress(decodeNaddr(m[1])))
    } catch {
      // prose
    }
  }
  return out
}

export default async function main() {
  const token = await agentToken()
  const q = async (filter: Record<string, unknown>) => {
    const r = await queryRelay(RELAY_URL, [filter], token.accessToken, token.pubkey)
    if (!r.ok) throw new Error(`read refused: ${r.reason}`)
    return r.events as unknown as Ev[]
  }
  const comments = await q({ kinds: [1111], limit: 5000 })
  const messages = await q({ kinds: [9], limit: 5000 })
  console.log(`${comments.length} kind:1111, ${messages.length} kind:9 readable on ${RELAY_URL} as ${token.pubkey.slice(0, 8)}…`)

  const tally: Record<string, number> = {}
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1)
  const examples: Record<string, string[]> = {}
  const note = (k: string, e: Ev, extra = '') => {
    ;(examples[k] ??= []).length < 3 && examples[k].push(`${e.id.slice(0, 8)} ${new Date(e.created_at * 1000).toISOString().slice(0, 10)} ${extra} ${JSON.stringify(e.content.slice(0, 60))}`)
  }

  for (const e of [...comments, ...messages]) {
    const app = tagsNamed(e, 'ts').length ? 'ship' : 'peek'
    const isRoot = tagsNamed(e, 'e').length === 0
    const A = tagsNamed(e, 'A')
    const a = tagsNamed(e, 'a')
    const body = bodyAddresses(e.content)
    const role = isRoot ? 'root' : 'reply'
    if (e.kind === 1111) {
      const hasA = A.length > 0
      const extra = a.filter((x) => !A.includes(x))
      for (const x of extra) {
        const key = `1111 ${role} ${app} A=${hasA ? 'yes' : 'no'} a≠A ${body.has(x) ? 'in-body(mention)' : 'not-in-body'} → kind ${x.split(':')[0]}`
        bump(key)
        note(key, e, `A=${A[0]?.split(':')[0] ?? '-'}`)
      }
      if (!extra.length) bump(`1111 ${role} ${app} A=${hasA ? 'yes' : 'no'} a⊆A`)
      if (!hasA) note(`1111 ${role} ${app} A=no a⊆A`, e, `a=${a.map((x) => x.split(':')[0]).join(',')}`)
    } else {
      if (!a.length) {
        bump(`9 ${role} ${app} no a`)
        continue
      }
      for (const x of a) {
        const key = `9 ${role} ${app} a ${body.has(x) ? 'in-body(mention)' : 'not-in-body(anchor)'} → kind ${x.split(':')[0]}`
        bump(key)
        note(key, e, `h=${tagsNamed(e, 'h')[0]?.slice(0, 8)}`)
      }
    }
  }
  for (const k of Object.keys(tally).sort()) {
    console.log(`${String(tally[k]).padStart(5)}  ${k}`)
    for (const ex of examples[k] ?? []) console.log(`         ${ex}`)
  }
}
