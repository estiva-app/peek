/**
 * Which issuer a set of credentials came from (PEEK-39).
 *
 * This is the one piece of the pubkey migration that fails *silently* when it is
 * wrong. Convex Auth and Estiva ID both populate `getUserIdentity()`, and their
 * `subject` claims are not distinguishable by shape alone — so a viewer resolved
 * from the wrong issuer does not throw, it just quietly resolves to nobody. The
 * DB query around it is ordinary and needs no test; this does.
 *
 * Written against plain objects rather than a deployment, matching the way
 * `nostr/projection.test.ts` tests resolution with nothing running.
 */
import { describe, expect, it } from 'vitest'
import { ESTIVA_ID_ISSUER, pubkeyFromIdentity } from './users'

const PUBKEY = 'a'.repeat(64)

/** What Convex Auth puts in the identity: `<userId>|<sessionId>`, self-issued. */
const convexAuthIdentity = {
  issuer: 'https://peek-example-123.convex.site',
  subject: 'jd77xyz1234567890abcdef|js77abc1234567890abcdef',
}

const estivaIdIdentity = { issuer: ESTIVA_ID_ISSUER, subject: PUBKEY }

describe('pubkeyFromIdentity', () => {
  it('returns the pubkey for an Estiva ID token', () => {
    expect(pubkeyFromIdentity(estivaIdIdentity)).toBe(PUBKEY)
  })

  it('returns null when unauthenticated', () => {
    expect(pubkeyFromIdentity(null)).toBeNull()
  })

  it('returns null for a Convex Auth session, rather than reading its subject as a pubkey', () => {
    // The regression this file exists for: treat this subject as a pubkey and
    // every signed-in user silently becomes a stranger.
    expect(pubkeyFromIdentity(convexAuthIdentity)).toBeNull()
  })

  it('tolerates a trailing slash on the issuer', () => {
    expect(pubkeyFromIdentity({ ...estivaIdIdentity, issuer: `${ESTIVA_ID_ISSUER}/` })).toBe(PUBKEY)
  })

  it('refuses issuers that merely look like Estiva ID', () => {
    // Same shapes the live /authorize allowlist refuses; a substring or suffix
    // match here would hand a pubkey to whoever registered the lookalike.
    for (const issuer of [
      'https://id.estiva.app.attacker.example',
      'https://attacker.example/https://id.estiva.app',
      'https://id-estiva.app',
      'http://id.estiva.app',
      '',
    ]) {
      expect(pubkeyFromIdentity({ issuer, subject: PUBKEY })).toBeNull()
    }
  })

  it('agrees with the issuer Convex is configured to accept', () => {
    // auth.config.ts's `domain` and this constant are one agreement in two
    // files; if they drift, tokens validate and then resolve to nobody.
    expect(ESTIVA_ID_ISSUER).toBe('https://id.estiva.app')
  })
})
