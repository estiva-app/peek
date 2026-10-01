import { beforeEach, describe, expect, it, vi } from 'vitest'

const relay = vi.hoisted(() => ({
  answers: [] as { ok: boolean; events: { content: string; created_at: number }[] }[],
  plaintexts: {} as Record<string, string | undefined>,
}))
vi.mock('./bridge', () => ({
  queryRelay: vi.fn(async () => relay.answers.shift() ?? { ok: false, events: [] }),
  signViaEstivaId: vi.fn(),
  publishSigned: vi.fn(),
}))
vi.mock('./appData', () => ({
  decryptBlob: vi.fn(async (content: string) => relay.plaintexts[content]),
  encryptBlob: vi.fn(),
}))

import { fetchMutes } from './mutes'

const seam = { relayUrl: 'https://relay.test', accessToken: 't', pubkey: 'c'.repeat(64) }
const FILE = `30851:${'b'.repeat(64)}:file`
const FOLDER = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  relay.answers = []
  relay.plaintexts = {}
})

describe('fetchMutes — the private list, and the follow list it replaces (§11.8)', () => {
  it('reads the mute list when there is one, and ignores the retired follow list', async () => {
    relay.answers = [{ ok: true, events: [{ content: 'mute', created_at: 1 }] }]
    relay.plaintexts.mute = JSON.stringify({ v: 1, updatedAt: 5, keys: [FILE] })
    expect(await fetchMutes(seam)).toEqual({ state: 'present', keys: [FILE] })
  })

  it('takes the retired list’s mutes as the mute list while none exists, and nothing else of it', async () => {
    relay.answers = [
      { ok: true, events: [] },
      { ok: true, events: [{ content: 'old', created_at: 1 }] },
    ]
    relay.plaintexts.old = JSON.stringify({ v: 1, updatedAt: 5, keys: [`30851:${'a'.repeat(64)}:followed`], muted: { [FILE]: 3 } })
    expect(await fetchMutes(seam)).toEqual({ state: 'absent', keys: [FILE] })
  })

  it('drops a muted Folder of the retired list: the roster decides a general stream', async () => {
    relay.answers = [
      { ok: true, events: [] },
      { ok: true, events: [{ content: 'old', created_at: 1 }] },
    ]
    relay.plaintexts.old = JSON.stringify({ v: 1, updatedAt: 5, keys: [], muted: { [FOLDER]: 3 } })
    const read = await fetchMutes(seam)
    expect(read.state).toBe('absent')
  })

  it('is an empty absent list when neither exists', async () => {
    relay.answers = [
      { ok: true, events: [] },
      { ok: true, events: [] },
    ]
    expect(await fetchMutes(seam)).toEqual({ state: 'absent', keys: [] })
  })

  it('is unreachable, never empty, when the relay does not answer or the blob will not decrypt', async () => {
    relay.answers = [{ ok: false, events: [] }]
    expect(await fetchMutes(seam)).toEqual({ state: 'unreachable' })
    relay.answers = [{ ok: true, events: [{ content: 'mute', created_at: 1 }] }]
    expect(await fetchMutes(seam)).toEqual({ state: 'unreachable' })
  })
})
