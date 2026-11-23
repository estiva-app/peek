// @vitest-environment jsdom
/**
 * The report of a page that did not load says why (34396209), read at the wire: a read the relay refuses because the
 * minute is spent, a read Estiva ID will not sign because the sign-in ended, and a decrypt Estiva ID refuses at its
 * own limit, each followed by the failure a screen draws. What leaves the browser for Estiva ID names the reason from
 * the fixed list and none of their words.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const ME = 'a'.repeat(64)
const signIn = vi.hoisted(() => ({ ended: false }))
vi.mock('@/auth/estivaId', () => ({
  ESTIVA_ID_ORIGIN: 'https://id.estiva.app',
  currentEstivaToken: () => 'qa-1-token',
}))
// Signed here, not by Estiva ID: its answer to a sign-in that ended is the one thing taken from it.
vi.mock('@estiva-app/identity', async (original) => {
  const identity = await original<typeof import('@estiva-app/identity')>()
  return {
    ...identity,
    signViaEstivaId: async (event: object) => {
      if (signIn.ended) throw new identity.SignRefused(401, 'the access token has expired')
      return { ...event, id: 'id', sig: 'sig' }
    },
  }
})
vi.mock('@/nostr/deviceCopy', () => ({ keepRelayAnswer: vi.fn(), keepPlaintext: vi.fn(), plaintextFromCopy: () => undefined }))

import { decryptBlobUnlessRefused } from '@/nostr/appData'
import { queryRelay, setSocketReader } from '@/nostr/bridge'
import { startErrorReports } from './errorReports'
import { reportFailureNow } from './failureReports'

let reports: Array<{ how: string; named: string; reason?: string }>
let bodies: string[]

beforeEach(() => {
  reports = []
  bodies = []
  signIn.ended = false
  setSocketReader(null)
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 23) })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: { body?: string }) => {
      if (String(url).endsWith('/report')) {
        bodies.push(String(init?.body))
        reports.push(JSON.parse(String(init?.body)))
        return new Response(null, { status: 202 })
      }
      // Estiva ID's own per-minute limit, which a page of read state reaches.
      if (String(url).endsWith('/nip44/decrypt')) return new Response('Too many encryption requests', { status: 429 })
      // The relay, with this person's minute spent.
      return new Response(JSON.stringify({ error: 'rate-limited: quota exceeded; retry in 40s' }), { status: 429 })
    }),
  )
})

afterEach(() => {
  setSocketReader(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

/** The failure a screen draws once its read has failed. */
async function drawn() {
  reportFailureNow('not-loaded')
  await vi.advanceTimersByTimeAsync(0)
}

it('a page that did not load is reported with why: the relay said wait, the sign-in had ended, Estiva ID said wait, never in their words', async () => {
  startErrorReports()

  const refused = queryRelay('https://relay', [{ kinds: [9], authors: [ME] }], 'token', ME)
  await vi.advanceTimersByTimeAsync(1_000)
  expect((await refused).ok).toBe(false)
  await drawn()

  signIn.ended = true
  let unsigned = false
  queryRelay('https://relay', [{ kinds: [9], authors: [ME] }], 'token', ME).catch(() => (unsigned = true))
  await vi.advanceTimersByTimeAsync(1_000)
  expect(unsigned).toBe(true)
  await drawn()

  await expect(decryptBlobUnlessRefused('ciphertext', 'token')).rejects.toThrow()
  await drawn()

  expect(reports.map((r) => [r.how, r.named, r.reason])).toEqual([
    ['failure', 'not-loaded', 'told-to-wait'],
    ['failure', 'not-loaded', 'signed-out'],
    ['failure', 'not-loaded', 'id-told-to-wait'],
  ])
  for (const body of bodies) {
    expect(body).not.toContain('quota')
    expect(body).not.toContain('expired')
    expect(body).not.toContain('encryption')
  }
})
