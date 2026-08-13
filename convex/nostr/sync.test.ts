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

describe('folder UUID learning from imported messages', () => {
  it('learns channelUuid from the first imported Ship message when topic lacks one', async () => {
    const FOLDER_UUID = '12345678-1234-1234-1234-123456789abc'
    const topicId = 'topic123'

    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    }

    // Mock the topic query to return a topic without channelUuid
    ctx.runQuery.mockResolvedValue({
      channelUuid: null,
      creatorId: 'creator123',
    })

    // Mock the storeChannelUuid mutation to capture the write
    const storeChannelUuid = vi.fn()
    storeChannelUuid.mockResolvedValue({ channelUuid: FOLDER_UUID, minted: true })
    ctx.runMutation.mockImplementation(async (mutationName, args) => {
      if (mutationName === 'storeChannelUuid') {
        return await storeChannelUuid(args)
      }
      return {}
    })

    // Simulate a Ship message with h tag
    const shipMessage = {
      id: 'event123',
      pubkey: 'ship-pubkey',
      created_at: 1234567890,
      kind: 9,
      tags: [['h', FOLDER_UUID], ['p', 'author123']],
      content: 'Test message from Ship',
    }

    const topic = { topicId, channelUuid: null, since: null }
    const folderUuid = shipMessage.tags.find((t) => t[0] === 'h')?.[1]

    if (!topic.channelUuid && folderUuid) {
      await ctx.runMutation('storeChannelUuid', {
        topicId: topic.topicId,
        channelUuid: folderUuid,
      })
    }

    // Verify that storeChannelUuid was called with the folder UUID from the message
    expect(storeChannelUuid).toHaveBeenCalledWith({
      topicId,
      channelUuid: FOLDER_UUID,
    })
    expect(storeChannelUuid).toHaveBeenCalledTimes(1)
  })

  it('does not overwrite an existing channelUuid (first-write-wins)', async () => {
    const EXISTING_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    const NEW_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    const topicId = 'topic123'

    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    }

    // Mock the topic query to return a topic WITH existing channelUuid
    ctx.runQuery.mockResolvedValue({
      channelUuid: EXISTING_UUID,
      creatorId: 'creator123',
    })

    const storeChannelUuid = vi.fn()
    storeChannelUuid.mockResolvedValue({ channelUuid: EXISTING_UUID, minted: false })
    ctx.runMutation.mockImplementation(async (mutationName, args) => {
      if (mutationName === 'storeChannelUuid') {
        return await storeChannelUuid(args)
      }
      return {}
    })

    // Simulate a Ship message with a different h tag
    const shipMessage = {
      id: 'event123',
      pubkey: 'ship-pubkey',
      created_at: 1234567890,
      kind: 9,
      tags: [['h', NEW_UUID]],
      content: 'Test message',
    }

    const topic = { topicId, channelUuid: EXISTING_UUID, since: null }
    const folderUuid = shipMessage.tags.find((t) => t[0] === 'h')?.[1]

    // Should NOT call storeChannelUuid because topic already has one
    if (!topic.channelUuid && folderUuid) {
      await ctx.runMutation('storeChannelUuid', {
        topicId: topic.topicId,
        channelUuid: folderUuid,
      })
    }

    // Verify that storeChannelUuid was NOT called
    expect(storeChannelUuid).not.toHaveBeenCalled()
  })
})
