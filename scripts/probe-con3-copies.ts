/**
 * CON-3, leg 2: where FOL-25's 549 copies went, and whether a `#h` read can see
 * them all. Relay-only, so it costs no Convex sweep.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con3-copies.ts
 *
 * `probe-con3-discriminator.ts` finds 134 `orig`-tagged events, all marked
 * `fol25-remigrate`, and none from `migrate` — but `migrate` posted 549. Two
 * explanations answer differently and only one is benign:
 *
 *   - `remigrate` takes each agent copy down with a `kind:5` after re-posting
 *     the author-signed one, so a retracted copy is simply no longer readable;
 *   - or the `#h` read is clamped and the rest are there, unseen.
 *
 * So this counts per team, per file address, by `#h` and by `#A` (a NIP-22
 * reply keeps the uppercase root tag and drops the lowercase `a`), and asks for
 * the `kind:5`s directly.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const TEAMS: Record<string, string> = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
}

interface Token {
  accessToken: string
  pubkey: string
}

async function token(): Promise<Token> {
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

async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const url = `${RELAY_URL}/query`
  const body = JSON.stringify(filters)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  const text = await res.text()
  if (res.status !== 200) {
    console.log(`⚠  /query ${res.status}: ${text.slice(0, 160)}`)
    return []
  }
  try {
    return JSON.parse(text) as SignedEvent[]
  } catch {
    return []
  }
}

const tagOf = (e: SignedEvent, name: string) => e.tags.find((x) => x[0] === name)?.[1]
const origOf = (e: SignedEvent) => e.tags.find((x) => x[0] === 'orig')?.[1]
const remigrated = (e: SignedEvent) => e.tags.some((x) => x[0] === 'migration' && x[1] === 'fol25-remigrate')

async function main() {
  const t = await token()

  // ---- 1. Is the `#h` read clamped? Ask for far more than exists.
  const wide = await query([{ kinds: [9, 1111], '#h': [TEAMS.Peek!], limit: 100000 }], t)
  console.log(`clamp check: #h Peek, limit 100000 → ${wide.length} events (a round number would mean a clamp)\n`)

  // ---- 2. The files FOL-25 made, per team, and what hangs off each.
  console.log('team          file                                      title                                #h  #A  orig  remig')
  let totalOrig = 0
  for (const [name, id] of Object.entries(TEAMS)) {
    const files = (await query([{ kinds: [30840], '#h': [id], limit: 500 }], t)).filter((e) => tagOf(e, 'd'))
    const underTeam = await query([{ kinds: [9, 1111], '#h': [id], limit: 5000 }], t)
    for (const f of files) {
      const address = `30840:${f.pubkey}:${tagOf(f, 'd')}`
      const viaA = await query([{ kinds: [1111], '#A': [address], limit: 5000 }], t)
      const byH = underTeam.filter((e) => (e.tags.find((x) => x[0] === 'A') ?? e.tags.find((x) => x[0] === 'a'))?.[1] === address)
      const orig = viaA.filter((e) => origOf(e))
      totalOrig += orig.length
      if (viaA.length === 0 && byH.length === 0) continue
      console.log(
        `${name.padEnd(13)} ${tagOf(f, 'd')!.slice(0, 8)}…                                ${String(tagOf(f, 'title') ?? '').slice(0, 34).padEnd(34)} ` +
          `${String(byH.length).padStart(3)} ${String(viaA.length).padStart(3)} ${String(orig.length).padStart(5)} ${String(orig.filter(remigrated).length).padStart(6)}`,
      )
    }
  }
  console.log(`\n${totalOrig} orig-tagged copies readable across every file`)

  // ---- 3. The agent's own retractions: `migrate`'s copies are not missing,
  //         they were taken down. A kind:5 stays readable, its target does not.
  const dels = await query([{ kinds: [5], authors: [t.pubkey], limit: 5000 }], t)
  const targets = [...new Set(dels.flatMap((e) => e.tags.filter((x) => x[0] === 'e').map((x) => x[1]!)))]
  console.log(`\nkind:5 by the agent: ${dels.length}, naming ${targets.length} distinct target(s)`)
  const alive: string[] = []
  for (let i = 0; i < targets.length; i += 100) {
    alive.push(...(await query([{ ids: targets.slice(i, i + 100), limit: 100 }], t)).map((e) => e.id))
  }
  console.log(`  of those targets, still readable: ${alive.length}  ← a retracted event stops answering`)
  const span = dels.map((e) => e.created_at).sort((a, b) => a - b)
  if (span.length) {
    console.log(`  sent between ${new Date(span[0]! * 1000).toISOString().slice(0, 16)} and ${new Date(span.at(-1)! * 1000).toISOString().slice(0, 16)} UTC`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
