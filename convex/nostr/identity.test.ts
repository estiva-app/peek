/**
 * Who scheduled work is allowed to sign as.
 *
 * Two mistakes have shipped from this function, and both were silent:
 *
 *   1. It minted a fresh keypair over the real pubkey of anyone whose key Peek
 *      does not hold, detaching them from everything they had published.
 *   2. It paired the *user's* pubkey with a *service* token and claimed the
 *      result was authored by that user. `/sign` ignores the pubkey it is given
 *      and signs as the token's subject, so those events belonged to the
 *      service while Peek's own records said otherwise.
 *
 * Neither threw. The contract worth pinning is therefore narrow: sign with a key
 * we actually hold, or return null and let the caller skip.
 */
import { describe, expect, it, vi } from 'vitest'
import { internal } from '../_generated/api'
import { identityFor } from './publish'

const USER_PUBKEY = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const SECRET = 'b'.repeat(64)
const USER = 'md74p1q1fxe420qsjjtnzj41858c901z' as never

/** A ctx whose `getUserKeys` returns the given row shape. */
function ctxFor(row: { nostrPubkey?: string | null; nostrSecretKey?: string | null } | null) {
  return { runQuery: vi.fn().mockResolvedValue(row), runMutation: vi.fn() }
}

describe('identityFor', () => {
  it('signs locally for a user whose key Peek still custodies', async () => {
    const ctx = ctxFor({ nostrPubkey: USER_PUBKEY, nostrSecretKey: SECRET })

    await expect(identityFor(ctx, USER)).resolves.toEqual({
      pubkey: USER_PUBKEY,
      secretKeyHex: SECRET,
    })
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.nostr.data.getUserKeys, { userId: USER })
  })

  it('returns null for an Estiva ID identity rather than signing as someone else', async () => {
    // The regression. Peek holds no key here, and background work cannot see
    // this person's token — so there is no honest way to publish for them. A
    // service token is not a substitute: the event would carry the service's
    // signature under the user's name.
    const ctx = ctxFor({ nostrPubkey: USER_PUBKEY, nostrSecretKey: null })

    await expect(identityFor(ctx, USER)).resolves.toBeNull()
  })

  it('never mints a key, for anyone', async () => {
    // The older regression: minting over an existing pubkey is unrecoverable,
    // so no input may reach a write.
    for (const row of [
      { nostrPubkey: USER_PUBKEY, nostrSecretKey: null },
      { nostrPubkey: null, nostrSecretKey: null },
      {},
    ]) {
      const ctx = ctxFor(row)
      await identityFor(ctx, USER)
      expect(ctx.runMutation).not.toHaveBeenCalled()
    }
  })

  it('returns null when the user has no identity at all', async () => {
    await expect(identityFor(ctxFor({ nostrPubkey: null }), USER)).resolves.toBeNull()
  })

  it('returns null for a user that does not exist', async () => {
    await expect(identityFor(ctxFor(null), USER)).resolves.toBeNull()
  })
})
