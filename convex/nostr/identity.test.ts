/**
 * Peek must never mint a key over an identity it does not hold.
 *
 * This is the guard on the worst bug this codebase has had. `identityFor`
 * used to test `pubkey && secret` before minting, so a user with a pubkey and
 * **no** secret — exactly what `adoptIdentity` creates for someone who signed
 * in through Estiva ID — fell through and had a fresh keypair written over
 * their real pubkey.
 *
 * Nothing threw. `viewerId()` resolves people by `by_nostrPubkey`, so from that
 * instant they stopped matching their own row: every query returned empty,
 * every mutation threw "Not signed in", and everything they had published
 * detached from them. It reached production.
 *
 * `identityFor` lives in a `"use node"` module and reaches the database through
 * `ctx.runQuery`/`ctx.runMutation`, so it is exercised here against a fake ctx —
 * the decision is pure, and the decision is what went wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { identityFor } from './publish'

// Minting seals the new secret, which needs the real env var present.
beforeEach(() => vi.stubEnv('NOSTR_KEY_ENCRYPTION_SECRET', 'x'.repeat(64)))
afterEach(() => vi.unstubAllEnvs())

const PUBKEY = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const USER = 'md74p1q1fxe420qsjjtnzj41858c901z' as never

/** A ctx whose `getUserKeys` returns the given row shape. */
function ctxFor(row: { nostrPubkey?: string; nostrSecretKey?: string } | null) {
  return {
    runQuery: vi.fn().mockResolvedValue(row),
    // Echoes the args back, the way the real `storeKeypair` returns whatever is
    // effectively stored — so the sealed secret it hands back can be decrypted.
    runMutation: vi.fn(async (_fn: unknown, args: { nostrPubkey: string; nostrSecretKey: string }) => ({
      nostrPubkey: args.nostrPubkey,
      nostrSecretKey: args.nostrSecretKey,
    })),
  }
}

describe('identityFor', () => {
  it('refuses to sign for a pubkey it holds no secret for', async () => {
    // The regression: an Estiva ID user. Must return null, not mint.
    const ctx = ctxFor({ nostrPubkey: PUBKEY })

    expect(await identityFor(ctx, USER)).toBeNull()
    expect(ctx.runMutation).not.toHaveBeenCalled()
  })

  it('never writes over an existing pubkey', async () => {
    // Stated separately from the return value because this is the irreversible
    // half: a returned null is recoverable, an overwritten pubkey is not.
    const ctx = ctxFor({ nostrPubkey: PUBKEY })
    await identityFor(ctx, USER)

    const wrote = ctx.runMutation.mock.calls.some(([, args]) => args && 'nostrPubkey' in args)
    expect(wrote).toBe(false)
  })

  it('still mints for a user who has no identity at all', async () => {
    // Convex Auth users predate Estiva ID and have no pubkey; they must keep
    // working until PEEK-40 moves signing, or publishing breaks for everyone.
    const ctx = ctxFor({})

    expect(await identityFor(ctx, USER)).not.toBeNull()
    expect(ctx.runMutation).toHaveBeenCalledOnce()
  })

  it('throws for a user that does not exist', async () => {
    await expect(identityFor(ctxFor(null), USER)).rejects.toThrow(/unknown user/)
  })
})
