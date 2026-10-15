import { beforeEach, describe, expect, it, vi } from 'vitest'

const relay = vi.hoisted(() => ({
  answers: [] as { ok: boolean; events: { id: string; content: string; created_at: number }[] }[],
  plaintexts: {} as Record<string, string | undefined>,
  decrypts: 0,
}))
vi.mock('./bridge', () => ({
  queryRelay: vi.fn(async () => relay.answers.shift() ?? { ok: false, events: [] }),
}))
vi.mock('./appData', () => ({
  decryptBlob: vi.fn(async (content: string) => {
    relay.decrypts++
    return relay.plaintexts[content]
  }),
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
    relay.answers = [{ ok: true, events: [{ id: 'mute', content: 'mute', created_at: 1 }] }]
    relay.plaintexts.mute = JSON.stringify({ v: 1, updatedAt: 5, keys: [FILE] })
    expect(await fetchMutes(seam)).toEqual({ state: 'present', keys: [FILE] })
  })

  it('reads the newest mute list when the relay returns an older one first', async () => {
    const OTHER = `30851:${'d'.repeat(64)}:other`
    relay.answers = [
      {
        ok: true,
        events: [
          { id: 'mute-old', content: 'mute-old', created_at: 1 },
          { id: 'mute-new', content: 'mute-new', created_at: 2 },
        ],
      },
    ]
    relay.plaintexts['mute-old'] = JSON.stringify({ v: 1, updatedAt: 1, keys: [OTHER] })
    relay.plaintexts['mute-new'] = JSON.stringify({ v: 1, updatedAt: 2, keys: [FILE] })
    expect(await fetchMutes(seam)).toEqual({ state: 'present', keys: [FILE] })
  })

  it('takes the retired list’s mutes as the mute list while none exists, and nothing else of it', async () => {
    relay.answers = [
      { ok: true, events: [] },
      { ok: true, events: [{ id: 'old', content: 'old', created_at: 1 }] },
    ]
    relay.plaintexts.old = JSON.stringify({ v: 1, updatedAt: 5, keys: [`30851:${'a'.repeat(64)}:followed`], muted: { [FILE]: 3 } })
    expect(await fetchMutes(seam)).toEqual({ state: 'absent', keys: [FILE] })
  })

  it('carries a muted Folder of the retired list as the package gives it: harmless, a Folder lights only for a mention', async () => {
    relay.answers = [
      { ok: true, events: [] },
      { ok: true, events: [{ id: 'old2', content: 'old2', created_at: 1 }] },
    ]
    relay.plaintexts.old2 = JSON.stringify({ v: 1, updatedAt: 5, keys: [], muted: { [FOLDER]: 3 } })
    expect(await fetchMutes(seam)).toEqual({ state: 'absent', keys: [FOLDER] })
  })

  it('decrypts an event once, however often the list is read', async () => {
    relay.plaintexts.cached = JSON.stringify({ v: 1, updatedAt: 5, keys: [FILE] })
    relay.decrypts = 0
    for (let i = 0; i < 3; i++) {
      relay.answers = [{ ok: true, events: [{ id: 'cached', content: 'cached', created_at: 1 }] }]
      expect(await fetchMutes(seam)).toEqual({ state: 'present', keys: [FILE] })
    }
    expect(relay.decrypts).toBe(1)
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
    // An id no earlier test decrypted: a success is kept, a failure is not.
    relay.answers = [{ ok: true, events: [{ id: 'undecryptable', content: 'undecryptable', created_at: 1 }] }]
    expect(await fetchMutes(seam)).toEqual({ state: 'unreachable' })
  })
})
