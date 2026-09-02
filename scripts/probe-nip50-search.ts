/**
 * Measure what the relay actually does with a NIP-50 `search` filter (PEE-4).
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   RELAY_URL=https://estiva.estiva.app npx tsx scripts/probe-nip50-search.ts
 *
 * PEE-4 says NIP-50 is **advertised, not measured**, and that is the whole
 * reason this runs before any of the search UI is designed. NIP-11 lists 50 in
 * `supported_nips`; a relay that parses the filter and drops the unknown
 * `search` field answers *identically to a working one* on any query whose
 * results you did not count — so "search returned things" is not evidence.
 *
 * Hence the shape of this probe: **every positive is paired with a negative
 * control.** A nonsense token that returns rows means `search` is being
 * ignored and the rows are simply everything of that kind. Without the pair,
 * an ignored field looks like a working feature and the ticket's search UI
 * gets designed against a filter that does not filter.
 *
 * Read-only. It publishes nothing.
 */
import { buildUnsignedAuthEvent, authorizationHeaderFor } from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = process.env.RELAY_URL ?? 'https://estiva.estiva.app'
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

const KIND_PROFILE = 0
const KIND_MESSAGE = 9
const KIND_TOPIC = 39000

/** Nothing in any corpus spells this. Any row back means `search` was dropped. */
const NONSENSE = 'zzqx' + 'vwmk' + 'jjbt' + 'plfd'

let failures = 0
function check(label: string, ok: boolean, detail = ''): boolean {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
  return ok
}
function note(label: string, detail = '') {
  console.log(`   ${label}${detail ? ` — ${detail}` : ''}`)
}

async function token(): Promise<{ accessToken: string; pubkey: string }> {
  const res = await fetch(`${ID_ORIGIN}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // camelCase — Estiva ID's /token is not OAuth-shaped, and a snake_case
    // body comes back "401 No session cookie", which reads as a credential
    // problem rather than a schema one.
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

/** NIP-98 over the HTTP bridge. The auth event is signed per request. */
async function bridge(path: string, payload: unknown, t: { accessToken: string; pubkey: string }) {
  const url = `${RELAY_URL.replace(/\/+$/, '')}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t.accessToken)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

type Filter = Record<string, unknown>

/**
 * `/query` takes a **bare array of filters** and answers with a **bare array of
 * events** — not `{events: […]}`. Reading `.events` off the answer yields
 * undefined and therefore an empty result, which looks exactly like "nothing
 * matched" and would pass every negative control here while proving nothing.
 */
async function query(filters: Filter[], t: { accessToken: string; pubkey: string }): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', filters, t)
  if (status !== 200) throw new Error(`POST /query ${JSON.stringify(filters)}: ${status} ${text}`)
  return JSON.parse(text) as SignedEvent[]
}

/** The name a profile or channel-metadata event goes by, for reporting. */
function labelOf(e: SignedEvent): string {
  try {
    const c = JSON.parse(e.content) as { display_name?: string; name?: string; about?: string }
    return c.display_name ?? c.name ?? '(unnamed)'
  } catch {
    return e.content.slice(0, 40).replace(/\s+/g, ' ')
  }
}

async function main() {
  console.log(`relay ${RELAY_URL}\n`)

  // ── 1. What NIP-11 claims, read rather than quoted ──────────────────────
  const nip11 = await fetch(RELAY_URL, { headers: { accept: 'application/nostr+json' } })
  const info = (await nip11.json()) as { supported_nips?: number[]; name?: string; software?: string }
  const advertised = (info.supported_nips ?? []).includes(50)
  check('NIP-11 advertises NIP-50', advertised, `supported_nips = ${JSON.stringify(info.supported_nips ?? [])}`)
  note('software', `${info.software ?? '?'}`)

  const t = await token()
  note('identity', t.pubkey.slice(0, 16) + '…')
  console.log()

  // ── 2. The control that decides whether any of the rest means anything ──
  //
  // If a nonsense token comes back with rows, the relay parsed the filter,
  // ignored `search`, and answered with everything of that kind. Every
  // "search works" result below would then be that same unfiltered list.
  for (const [name, kind] of [
    ['messages', KIND_MESSAGE],
    ['profiles', KIND_PROFILE],
    ['topics', KIND_TOPIC],
  ] as const) {
    const rows = await query([{ kinds: [kind], search: NONSENSE, limit: 50 }], t)
    check(
      `search is honoured for ${name} (kind:${kind})`,
      rows.length === 0,
      rows.length === 0
        ? 'nonsense token → 0 rows'
        : `nonsense token → ${rows.length} rows, so \`search\` is being IGNORED`,
    )
  }
  console.log()

  // ── 3. Baselines, so a filtered count can be compared to something ──────
  const totals: Record<string, number> = {}
  for (const [name, kind] of [
    ['messages', KIND_MESSAGE],
    ['profiles', KIND_PROFILE],
    ['topics', KIND_TOPIC],
  ] as const) {
    const rows = await query([{ kinds: [kind], limit: 500 }], t)
    totals[name] = rows.length
    note(`${name} readable by this identity`, `${rows.length}${rows.length === 500 ? ' (hit the limit)' : ''}`)
  }
  console.log()

  // ── 4. Does it actually match, and on what ──────────────────────────────
  //
  // The term is taken from the corpus rather than invented, so a zero here is
  // the relay's answer about matching and not about our vocabulary.
  const someProfiles = await query([{ kinds: [KIND_PROFILE], limit: 200 }], t)
  const term = (() => {
    for (const e of someProfiles) {
      const name = labelOf(e)
      const word = name.split(/\s+/).find((w) => w.length >= 4 && /^[A-Za-z]+$/.test(w))
      if (word) return word
    }
    return undefined
  })()

  if (!term) {
    check('a term could be taken from the profile corpus', false, 'no profile carries a 4+ letter word')
  } else {
    note('term taken from the corpus', `"${term}"`)
    const hits = await query([{ kinds: [KIND_PROFILE], search: term, limit: 50 }], t)
    check(
      `people search matches "${term}"`,
      hits.length > 0 && hits.length < totals.profiles,
      `${hits.length} of ${totals.profiles} profiles${hits.length >= totals.profiles ? ' — that is everything, so it did not filter' : ''}`,
    )
    if (hits.length) note('first hits', hits.slice(0, 5).map(labelOf).join(' · '))

    // Case sensitivity decides whether the launcher has to normalise input.
    const upper = await query([{ kinds: [KIND_PROFILE], search: term.toUpperCase(), limit: 50 }], t)
    check(
      'people search is case-insensitive',
      upper.length === hits.length,
      `"${term.toUpperCase()}" → ${upper.length} vs "${term}" → ${hits.length}`,
    )

    /*
      A prefix is what a launcher actually sends — nobody finishes a word
      before expecting results. Reported as a MEASUREMENT rather than a check:
      there is no correct answer here, only a property the search UI has to be
      designed around, and failing the run over it would read as the relay
      being broken.
    */
    const prefix = term.slice(0, 3)
    const partial = await query([{ kinds: [KIND_PROFILE], search: prefix, limit: 50 }], t)
    note(
      `3-letter prefix ("${prefix}") → ${partial.length} rows`,
      partial.length > 0
        ? 'prefixes match, so the launcher can query every keystroke'
        : 'WHOLE TOKENS ONLY — a type-as-you-go launcher gets nothing until a word is finished',
    )
  }
  console.log()

  // ── 5. Message content search, which is the useful one ──────────────────
  const msgs = await query([{ kinds: [KIND_MESSAGE], limit: 200 }], t)
  const msgTerm = (() => {
    for (const e of msgs) {
      const word = e.content.split(/\s+/).find((w) => w.length >= 5 && /^[A-Za-z]+$/.test(w))
      if (word) return word
    }
    return undefined
  })()
  if (!msgTerm) {
    note('no message term available', `${msgs.length} messages readable, none with a 5+ letter word`)
  } else {
    note('message term taken from the corpus', `"${msgTerm}"`)
    const hits = await query([{ kinds: [KIND_MESSAGE], search: msgTerm, limit: 50 }], t)
    check(
      `message content search matches "${msgTerm}"`,
      hits.length > 0,
      `${hits.length} rows of ${totals.messages} readable`,
    )
    if (hits.length) {
      // Order is the client's decision if the relay does not rank — worth
      // knowing which, because the launcher has to sort something.
      const times = hits.map((h) => h.created_at)
      const descending = times.every((v, i) => i === 0 || times[i - 1] >= v)
      note('ordering', descending ? 'newest first (time-ordered, no relevance rank)' : 'not time-ordered')
      note('first hit', hits[0].content.slice(0, 60).replace(/\s+/g, ' '))
    }
  }
  console.log()

  // ── 6. What this probe cannot answer ────────────────────────────────────
  note('NOT measured: access filtering', 'needs a second relay-member identity and a private Folder')
  note('NOT measured: relevance ranking', 'no `search` result carried a score field to rank by')

  console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`\n💥 ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
