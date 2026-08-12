/**
 * The publish path signs via Estiva ID instead of decrypting a per-user key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { internal } from '../_generated/api'
import { identityFor } from './publish'

const SERVICE_PUBKEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const USER_PUBKEY = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const USER = 'md74p1q1fxe420qsjjtnzj41858c901z' as never

beforeEach(() => {
  vi.stubEnv('ESTIVA_ID_ORIGIN', 'https://id.estiva.app')
  vi.stubEnv('ESTIVA_ID_CLIENT_ID', 'estiva-peek')
  vi.stubEnv('ESTIVA_ID_CLIENT_SECRET', 'peek-service-secret')
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ access_token: 'token-123', pubkey: SERVICE_PUBKEY }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('identityFor', () => {
  it('uses the user pubkey with the service signing token', async () => {
    const ctx = { runQuery: vi.fn(), runMutation: vi.fn() }
    ctx.runQuery.mockResolvedValue({ nostrPubkey: USER_PUBKEY, nostrSecretKey: null })

    await expect(identityFor(ctx, USER)).resolves.toEqual({ pubkey: USER_PUBKEY, token: 'token-123' })
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.nostr.data.getUserKeys, { userId: USER })
    expect(ctx.runMutation).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://id.estiva.app/token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          grantType: 'client_credentials',
          clientId: 'estiva-peek',
          clientSecret: 'peek-service-secret',
        }),
      }),
    )
  })
})
