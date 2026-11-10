import { describe, expect, it, vi } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { buildMembershipChange } from '@estiva-app/conversation'

/*
  A file's members are read from the changes naming the people Peek knows,
  not from every change (ALO-19): the same members, and none of its text
  saves. The relay is stubbed at `queryRelay`, answering filters as NIP-01
  does, so what is asserted is what a reader gets back.
*/
const AUTHOR = 'a'.repeat(64)
const BEA = 'b'.repeat(64)
const CAL = 'c'.repeat(64)
const ME = 'd'.repeat(64)
const FILE = `30850:${AUTHOR}:d4d3f511-f10f-4413-9123-fb3f9b00bc92`
const FOLDER = '11111111-1111-4111-8111-111111111111'

let n = 0
const id = () => String(++n).padStart(64, '0')
const membership = (signer: string, person: string, member: boolean, at: number): SignedEvent => ({ ...buildMembershipChange(signer, at * 1000, { file: FILE, folder: FOLDER, person, member }), id: id(), sig: '' })
const lead = (person: string, at: number): SignedEvent => ({ id: id(), pubkey: AUTHOR, kind: 1851, created_at: at, tags: [['a', FILE], ['h', FOLDER], ['field', 'lead'], ['value', person], ['p', person]], content: '', sig: '' })
const textSave: SignedEvent = { id: id(), pubkey: AUTHOR, kind: 1851, created_at: 5, tags: [['a', FILE], ['h', FOLDER], ['field', 'description'], ['value', '']], content: 'x'.repeat(5000), sig: '' }
const held = [textSave, lead(BEA, 10), lead(CAL, 11), membership(AUTHOR, ME, true, 12), membership(BEA, BEA, false, 13)]

const matches = (e: SignedEvent, f: Record<string, unknown>) =>
  Object.entries(f).every(([k, v]) => {
    if (k === 'kinds') return (v as number[]).includes(e.kind)
    if (k.startsWith('#')) return e.tags.some((t) => t[0] === k.slice(1) && (v as string[]).includes(t[1]))
    return true
  })
const answered: SignedEvent[][] = []
vi.mock('./bridge', () => ({
  queryRelay: async (_url: string, filters: Record<string, unknown>[]) => {
    const events = held.filter((e) => filters.some((f) => matches(e, f)))
    answered.push(events)
    return { ok: true, events }
  },
}))

const { fetchFileMembers } = await import('./fileMembers')
const seam = { relayUrl: 'wss://relay.test', accessToken: 't', pubkey: ME }

describe("a file's members, read from the changes naming people (ALO-19)", () => {
  it('finds the same members as every change does, and reads none of its text saves', async () => {
    const every = await fetchFileMembers(seam, FILE)
    const named = await fetchFileMembers(seam, FILE, [AUTHOR, BEA, CAL])
    expect(named).toEqual(every)
    expect([...named!.keys()].sort()).toEqual([AUTHOR, CAL, ME].sort())
    expect(answered[1].map((e) => e.id)).not.toContain(textSave.id)
  })
})
