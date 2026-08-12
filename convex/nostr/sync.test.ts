import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as bridge from './bridge'
import { encryptSecretKey } from './keys'
import { queryWithReader } from './sync'

const USER_PUBKEY = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const RAW_SECRET_KEY = 'a'.repeat(64)

describe('sync fallback auth', () => {
  beforeEach(() => {
    vi.stubEnv('NOSTR_KEY_ENCRYPTION_SECRET', 'a'.repeat(32))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('decrypts a stored sealed nostrSecretKey before falling back to local relay auth', async () => {
    const sealedSecretKey = await encryptSecretKey(RAW_SECRET_KEY)

    const queryEvents = vi
      .spyOn(bridge, 'queryEvents')
      .mockImplementation(async (_filters, auth) => {
        if (auth.secretKeyHex) {
          expect(auth.secretKeyHex).toBe(RAW_SECRET_KEY)
          return { ok: true, events: [] }
        }
        return { ok: false, events: [], reason: 'service auth failed' }
      })

    const ctx = { runQuery: vi.fn() }
    ctx.runQuery.mockResolvedValue([{ nostrPubkey: USER_PUBKEY, nostrSecretKey: sealedSecretKey }])

    const result = await queryWithReader(ctx, { pubkey: USER_PUBKEY, token: 'token-123' }, [{}])

    expect(result.ok).toBe(true)
    expect(queryEvents).toHaveBeenCalledTimes(2)
  })
})
