/**
 * Is the commit-time `created_at` floor where we think it is? — CON-13.
 *
 *   set -a; . ~/.estiva-agent.env; set +a
 *   npx tsx --tsconfig tsconfig.app.json scripts/probe-con13-floor-knob.ts --floor 7200
 *
 * **Writes.** Everything it writes is a throwaway channel it mints itself and
 * hides with a `9008` on the way out — never an existing object. See the
 * Peek-team-Folder incident: a control is only a control if it is harmless
 * when the code under test is wrong.
 *
 * ## What it is measuring, and why the obvious probe does not work
 *
 * Two gates refuse a back-dated event, in order:
 *
 *  1. `BUZZ_MAX_TIMESTAMP_DRIFT_SECS` (default 900) refuses at ingest with a
 *     legible **400** and a reason in the body.
 *  2. Migration 0021's deferred constraint trigger aborts at COMMIT when a
 *     channel-bearing row is older than `buzz.created_at_floor`
 *     (`BUZZ_CREATED_AT_FLOOR_SECS`, default 960). It aborts *inside* the
 *     transaction, so the caller gets a bare **500** with no reason — the
 *     explanation only ever reaches the relay log.
 *
 * So "the event was refused" says nothing on its own: the same publish fails
 * identically whether the floor moved or the drift window did. The status code
 * is the discriminator, and this probe reports it per leg and fails if a
 * refusal inside the floor's range arrives as a 400 — that would mean the
 * drift gate answered first and the floor was never exercised at all.
 *
 * ## The legs
 *
 * | leg      | age     | with floor 7200 | with floor 960 (default) |
 * |----------|---------|-----------------|--------------------------|
 * | fresh    | 0 s     | accepted        | accepted                 |
 * | inside   | 3600 s  | **accepted**    | refused, 500             |
 * | beyond   | 86400 s | refused, 500    | refused, 500             |
 *
 * `fresh` is the probe's own soundness control: if it fails, the probe is
 * broken and no conclusion about the floor may be drawn from the other two.
 * `beyond` is the negative control the deploy needs — it distinguishes "the
 * floor moved to 7200" from "the rule was removed entirely", which a probe
 * that only publishes an accepted event cannot tell apart.
 *
 * Every accepted leg is read back by id. The floor aborts at COMMIT, so
 * "accepted" is a claim about a transaction that had not finished when the
 * response was written; only a read proves the row survived it.
 *
 * `--floor` is what the relay is *believed* to be running. The probe derives
 * its expectations from it and fails loudly on a mismatch, so a stale image is
 * a failure rather than a surprising table.
 */
import { randomUUID } from 'node:crypto'
import {
  buildUnsignedAuthEvent,
  authorizationHeaderFor,
  buildCreateChannel,
  buildDeleteChannel,
  buildMessage,
} from '@estiva-app/protocol'
import type { SignedEvent, UnsignedEvent } from '@estiva-app/protocol'

const ID_ORIGIN = process.env.ESTIVA_ID_ORIGIN ?? 'https://id.estiva.app'
const RELAY_URL = (process.env.RELAY_URL ?? 'https://estiva.estiva.app').replace(/\/+$/, '')
const CLIENT_ID = process.env.ESTIVA_ID_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.ESTIVA_ID_CLIENT_SECRET ?? ''

/** Seconds of history the relay is believed to tolerate. */
const FLOOR = Number(
  process.argv.find((a) => a.startsWith('--floor='))?.slice('--floor='.length) ??
    process.argv[process.argv.indexOf('--floor') + 1] ??
    960,
)

type Token = { accessToken: string; pubkey: string }

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

async function sign(unsigned: UnsignedEvent, t: Token): Promise<SignedEvent> {
  const res = await fetch(`${ID_ORIGIN}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t.accessToken}` },
    body: JSON.stringify({ event: unsigned }),
  })
  if (!res.ok) throw new Error(`POST /sign kind:${unsigned.kind}: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { event: SignedEvent }).event
}

async function bridge(path: '/query' | '/events', payload: unknown, t: Token): Promise<{ status: number; text: string }> {
  const url = `${RELAY_URL}${path}`
  const body = JSON.stringify(payload)
  const auth = await sign(buildUnsignedAuthEvent({ pubkey: t.pubkey, url, method: 'POST', body }), t)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: authorizationHeaderFor(auth) },
    body,
  })
  return { status: res.status, text: await res.text() }
}

async function query(filters: Record<string, unknown>[], t: Token): Promise<SignedEvent[]> {
  const { status, text } = await bridge('/query', filters, t)
  if (status !== 200) throw new Error(`POST /query: ${status} ${text}`)
  return JSON.parse(text) as SignedEvent[]
}

type Publish = { ok: boolean; status: number; reason: string; id: string }

async function publish(unsigned: UnsignedEvent, t: Token): Promise<Publish> {
  const signed = await sign(unsigned, t)
  const { status, text } = await bridge('/events', signed, t)
  let parsed: { accepted?: boolean; reason?: string; message?: string } = {}
  try {
    parsed = JSON.parse(text)
  } catch {
    // A floor abort is a bare 500 with a non-JSON body; that is the signal.
  }
  const ok = status === 200 && parsed.accepted !== false
  return { ok, status, reason: parsed.reason ?? parsed.message ?? text.slice(0, 120), id: signed.id }
}

let failed = false
const step = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('ESTIVA_ID_CLIENT_ID / ESTIVA_ID_CLIENT_SECRET are not set')
  if (!Number.isFinite(FLOOR) || FLOOR <= 0) throw new Error(`--floor must be a positive integer, got ${FLOOR}`)

  const t = await token()
  console.log(`relay  ${RELAY_URL}`)
  console.log(`agent  ${t.pubkey.slice(0, 16)}…`)
  console.log(`floor  ${FLOOR}s (believed)\n`)

  // A throwaway container. Minted here, hidden below, referenced by nothing.
  const channelUuid = randomUUID()
  const name = `CON-13 floor probe ${channelUuid.slice(0, 8)}`
  const created = await publish(buildCreateChannel(t.pubkey, Date.now(), { channelUuid, name, visibility: 'private' }), t)
  step(`throwaway channel ${channelUuid.slice(0, 8)} created`, created.ok, created.ok ? name : `${created.status} ${created.reason}`)
  if (!created.ok) {
    console.log('\nnothing was published; no cleanup needed')
    process.exitCode = 1
    return
  }

  const legs = [
    { leg: 'fresh ', age: 0, why: 'probe soundness control' },
    { leg: 'inside', age: 3600, why: 'the measurement' },
    { leg: 'beyond', age: 86400, why: 'negative control' },
  ]

  const results: Array<{ leg: string; age: number; res: Publish; expectAccepted: boolean }> = []
  for (const { leg, age, why } of legs) {
    const expectAccepted = age < FLOOR
    const res = await publish(
      buildMessage(t.pubkey, Date.now() - age * 1000, {
        channelUuid,
        content: `CON-13 floor probe, dated ${age}s back. Throwaway; this channel is hidden on the way out.`,
      }),
      t,
    )
    results.push({ leg, age, res, expectAccepted })

    const verdict = res.ok ? 'accepted' : `refused ${res.status}`
    step(
      `${leg} ${String(age).padStart(5)}s  ${verdict.padEnd(12)} (${why})`,
      res.ok === expectAccepted,
      res.ok === expectAccepted ? '' : `expected ${expectAccepted ? 'accepted' : 'refused'}`,
    )

    // The discriminator. A refusal that should have come from the commit-time
    // floor but arrives as a 400 came from the ingest drift gate instead, and
    // the floor was never reached — the run proves nothing either way.
    if (!res.ok && res.status !== 500) {
      step(
        `${leg} refusal is the floor, not the drift gate`,
        false,
        `status ${res.status} (${res.reason}); widen BUZZ_MAX_TIMESTAMP_DRIFT_SECS past ${FLOOR} and re-run`,
      )
    }
  }

  // Accepted is a claim about a transaction that had not committed yet. Read
  // the rows back before believing any of it.
  const landed = new Set((await query([{ kinds: [9], '#h': [channelUuid], limit: 50 }], t)).map((e) => e.id))
  for (const { leg, res, expectAccepted } of results) {
    if (!expectAccepted) continue
    step(`${leg} readable on the relay`, landed.has(res.id), landed.has(res.id) ? res.id.slice(0, 12) : 'accepted but absent')
  }
  step(
    'no refused leg landed anyway',
    results.filter((r) => !r.res.ok).every((r) => !landed.has(r.res.id)),
    `${landed.size} kind:9 in the channel`,
  )

  const hidden = await publish(buildDeleteChannel(t.pubkey, Date.now(), { channelUuid }), t)
  step(`throwaway channel hidden`, hidden.ok, hidden.ok ? '' : `${hidden.status} ${hidden.reason} — hide ${channelUuid} by hand`)

  console.log(`\n${failed ? 'FAILED' : 'all legs as expected'} for a floor of ${FLOOR}s`)
  process.exitCode = failed ? 1 : 0
}

await main()
