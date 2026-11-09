/**
 * The follow switch and Add on a place, at the wire (TEA-6): what reaches the
 * relay when a person picks Important, All or Not following on a topic, a
 * space or a team's chat, or adds someone — through the actions the header
 * calls (`usePeekActions`), from a read of the place as `usePlaceFollow` makes
 * it. Each is asserted on the signed event the fake relay was sent.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { buildMembershipChange, parseTeamsBlob, serializeTeamsBlob, TEAMS_D_TAG, type Place } from '@estiva-app/conversation'
import { installWireRelay, ME, RELAY, signed, tagOf, tagsOf, TOKEN, type WireRelay } from '@/test/wireRelay'
import { usePeekActions } from '@/api/actions'
import { readPlaceAsViewer } from '@/nostr/places'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))
vi.mock('@/api/internal/openWork', () => ({ useOpenWork: () => ({}) }))
vi.mock('@/api/internal/screener', () => ({ useScreener: () => ({}) }))

const MIKY = 'a'.repeat(64)
const KATERINA = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const BUZZ = 'e'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const D = 'd68a8c78-5ec7-4652-b236-89ab57ac5b1e'
const TOPIC = `30840:${MIKY}:${D}`
const CHAT = `39000:${BUZZ}:${TEAM}`
const T0 = 1_700_000_000

/** The held token, as `usePlaceFollow` reads the place with it. */
const held = { ...TOKEN, expiresAt: Number.MAX_SAFE_INTEGER }
const topic: Place = { address: TOPIC, team: TEAM }
const chat: Place = { address: CHAT, team: TEAM }
const root = signed({ kind: 30840, created_at: T0, tags: [['d', D], ['h', TEAM]] }, MIKY)
const roster = (...people: string[]) => signed({ kind: 39002, created_at: T0, tags: [['d', TEAM], ...people.map((p) => ['p', p])] }, BUZZ)
const asSpace = signed({ kind: 30890, created_at: T0, tags: [['d', TEAM], ['a', TOPIC, '', 'space']] }, BUZZ)
const change = (by: string, at: number, person: string, member: boolean) =>
  signed({ ...buildMembershipChange(by, at * 1000, { file: TOPIC, folder: TEAM, person, member }), created_at: at }, by)
const teamsList = (off: string[]) =>
  signed({ kind: 30078, created_at: T0, tags: [['d', TEAMS_D_TAG]], content: `fake-nip44:${Buffer.from(serializeTeamsBlob({ teams: {}, off }, 1)).toString('base64')}` })

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
})
afterAll(() => vi.unstubAllGlobals())

const actions = () => renderHook(() => usePeekActions()).result.current
const pick = async (place: Place, choice: 'important' | 'all' | 'not-following' | 'default') => {
  const read = await readPlaceAsViewer(place, RELAY, held)
  relay.sent.length = 0
  return actions().choosePlaceLevel({ place, folder: TEAM, choice, read, archived: false, muted: false })
}
const fieldOf = (event: { tags: string[][] }) => [tagOf(event, 'field'), tagOf(event, 'value')]
/** The `off` entries of the newest teams list the viewer wrote. */
const offWritten = () => {
  const lists = relay.sentOf(30078).filter((e) => tagOf(e, 'd') === TEAMS_D_TAG)
  const last = lists[lists.length - 1]
  return last ? parseTeamsBlob(relay.decrypt(last.content))?.off : undefined
}

describe('the switch on a topic, at the wire', () => {
  beforeEach(() => relay.seed(root))

  it('Important sends one follow:<me> = important on the topic, signed by the viewer, filed in its Folder', async () => {
    expect(await pick(topic, 'important')).toEqual({ ok: true })
    const [level] = relay.sentOf(1851)
    expect(level.pubkey).toBe(ME)
    expect(tagOf(level, 'a')).toBe(TOPIC)
    expect(tagOf(level, 'h')).toBe(TEAM)
    expect(fieldOf(level)).toEqual([`follow:${ME}`, 'important'])
    expect(tagsOf(level, 'p')).toEqual([ME])
    expect(relay.sentOf(1851)).toHaveLength(1)
  })

  it('All sends follow:<me> = all', async () => {
    expect(await pick(topic, 'all')).toEqual({ ok: true })
    expect(relay.sentOf(1851).map(fieldOf)).toEqual([[`follow:${ME}`, 'all']])
  })

  it('Not following on a topic they were added to sends their leave, member:<me> = false, and no level', async () => {
    relay.seed(change(MIKY, T0 + 10, ME, true))
    expect(await pick(topic, 'not-following')).toEqual({ ok: true })
    const sent = relay.sentOf(1851)
    expect(sent.map(fieldOf)).toEqual([[`member:${ME}`, 'false']])
    expect(sent[0].pubkey).toBe(ME)
    expect(relay.sentOf(30078)).toHaveLength(0)
  })

  it('a refused level is said, and nothing claims it worked', async () => {
    relay.refuse({ when: (event) => event.kind === 1851 })
    expect(await pick(topic, 'all')).toEqual({ ok: false, reason: 'Nothing changed. Try again.' })
  })
})

describe('the switch on a space reached by its team’s default, at the wire', () => {
  beforeEach(() => relay.seed(root, roster(ME, MIKY), asSpace))

  it('Not following writes the space into the private off list, and nothing public', async () => {
    relay.seed(teamsList([]))
    expect(await pick(topic, 'not-following')).toEqual({ ok: true })
    expect(offWritten()).toEqual([D])
    expect(relay.sentOf(1851)).toHaveLength(0)
  })

  it('Not following after choosing All also empties the level, so All no longer holds', async () => {
    relay.seed(teamsList([]), signed({ kind: 1851, created_at: T0 + 5, tags: [['a', TOPIC], ['field', `follow:${ME}`], ['value', 'all'], ['h', TEAM], ['ts', String((T0 + 5) * 1000)], ['p', ME]] }))
    expect(await pick(topic, 'not-following')).toEqual({ ok: true })
    expect(relay.sentOf(1851).map(fieldOf)).toEqual([[`follow:${ME}`, '']])
    expect(offWritten()).toEqual([D])
  })

  it('picking a level again puts them back by a public level, and leaves the private list alone', async () => {
    relay.seed(teamsList([D]))
    expect(await pick(topic, 'important')).toEqual({ ok: true })
    expect(relay.sentOf(1851).map(fieldOf)).toEqual([[`follow:${ME}`, 'important']])
    expect(relay.sentOf(30078)).toHaveLength(0)
  })

  it('back to the team’s default takes the space out of the off list', async () => {
    relay.seed(teamsList([D]))
    expect(await pick(topic, 'default')).toEqual({ ok: true })
    expect(offWritten()).toEqual([])
  })

  it('a teams list that cannot be read is never written over, and nothing is sent', async () => {
    relay.seed(signed({ kind: 30078, created_at: T0, tags: [['d', TEAMS_D_TAG]], content: 'not-a-fake-ciphertext' }))
    expect(await pick(topic, 'not-following')).toEqual({ ok: false, reason: 'Your followed teams could not be read, so nothing was changed. Try again.' })
    expect(relay.sentOf(30078, 1851)).toHaveLength(0)
  })

  // A list from a newer version decrypts but does not parse: writing a v1 list over it would drop every team it follows.
  it('a teams list that decrypts but is not one this version reads is never written over, and nothing is sent', async () => {
    const future = `fake-nip44:${Buffer.from(JSON.stringify({ v: 2, teams: { [TEAM]: 1 } })).toString('base64')}`
    relay.seed(signed({ kind: 30078, created_at: T0, tags: [['d', TEAMS_D_TAG]], content: future }))
    expect(await pick(topic, 'not-following')).toEqual({ ok: false, reason: 'Your followed teams could not be read, so nothing was changed. Try again.' })
    expect(relay.sentOf(30078, 1851)).toHaveLength(0)
  })

  it('a teams list that turns unreadable between the read and the write is not written over: it says it was only partly changed', async () => {
    relay.seed(teamsList([]))
    const read = await readPlaceAsViewer(topic, RELAY, held)
    // Another device saved a list this tab cannot read, after the switch was drawn.
    relay.seed(signed({ kind: 30078, created_at: T0 + 10, tags: [['d', TEAMS_D_TAG]], content: 'not-a-fake-ciphertext' }))
    relay.sent.length = 0
    const result = await actions().choosePlaceLevel({ place: topic, folder: TEAM, choice: 'not-following', read, archived: false, muted: false })
    expect(result).toEqual({ ok: false, reason: 'Your followed teams could not be read, so it was only partly changed. Try again.' })
    expect(relay.sentOf(30078)).toHaveLength(0)
  })
})

describe('the switch on a team’s chat, at the wire', () => {
  beforeEach(() => relay.seed(roster(ME, MIKY)))

  it('All sends follow:<me> = all on the chat’s 39000 address, filed in the team', async () => {
    expect(await pick(chat, 'all')).toEqual({ ok: true })
    const [level] = relay.sentOf(1851)
    expect(tagOf(level, 'a')).toBe(CHAT)
    expect(tagOf(level, 'h')).toBe(TEAM)
    expect(fieldOf(level)).toEqual([`follow:${ME}`, 'all'])
  })

  it('Not following a member’s chat turns its default off by the team’s uuid', async () => {
    relay.seed(teamsList([]))
    expect(await pick(chat, 'not-following')).toEqual({ ok: true })
    expect(offWritten()).toEqual([TEAM])
  })
})

describe('Add, at the wire', () => {
  beforeEach(() => relay.seed(root))

  const add = async (person: string) => {
    const read = await readPlaceAsViewer(topic, RELAY, held)
    relay.sent.length = 0
    return actions().addToPlace({ place: topic, folder: TEAM, person, read })
  }

  it('sends member:<them> = true on the topic, signed by the viewer, naming them', async () => {
    expect(await add(KATERINA)).toEqual({ ok: true })
    const [added] = relay.sentOf(1851)
    expect(added.pubkey).toBe(ME)
    expect(tagOf(added, 'a')).toBe(TOPIC)
    expect(fieldOf(added)).toEqual([`member:${KATERINA}`, 'true'])
    expect(tagsOf(added, 'p')).toContain(KATERINA)
    expect(tagOf(added, 'prev')).toBeUndefined()
  })

  it('after they left, names their leave with prev, so the relay takes the Add as later', async () => {
    const leave = change(KATERINA, T0 + 20, KATERINA, false)
    relay.seed(change(MIKY, T0 + 10, KATERINA, true), leave)
    expect(await add(KATERINA)).toEqual({ ok: true })
    const [added] = relay.sentOf(1851)
    expect(fieldOf(added)).toEqual([`member:${KATERINA}`, 'true'])
    expect(tagOf(added, 'prev')).toBe(leave.id)
  })
})
