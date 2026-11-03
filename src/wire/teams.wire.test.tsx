/**
 * A team's writes, at the wire (TEA-5): what reaches the relay when a person
 * joins, leaves, adds someone, follows a team or marks a space, through the
 * actions the team page calls (`usePeekActions`). Each is asserted on the
 * signed event the fake relay was sent: kind, tags, content and signer.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { parseTeamsBlob, serializeTeamsBlob, TEAMS_D_TAG } from '@estiva-app/conversation'
import { installWireRelay, ME, signed, tagOf, tagsOf, type WireRelay } from '@/test/wireRelay'
import { usePeekActions } from '@/api/actions'

vi.mock('@/api/relayUrl', () => ({ RELAY_URL: 'https://relay.test', hasRelay: true }))
vi.mock('@/auth/estivaId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/estivaId')>()),
  validToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
  storedToken: () => ({ accessToken: 'wire-token', pubkey: 'c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2' }),
}))
// Only the actions under test; the Desk's own stores are not part of a team write.
vi.mock('@/api/internal/openWork', () => ({ useOpenWork: () => ({}) }))
vi.mock('@/api/internal/screener', () => ({ useScreener: () => ({}) }))

const TEAM = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'
const KATERINA = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const TOPIC = `30840:${ME}:brief`

let relay: WireRelay
beforeEach(() => {
  relay = installWireRelay()
})
afterAll(() => vi.unstubAllGlobals())

const actions = () => renderHook(() => usePeekActions()).result.current

describe('a team’s membership, at the wire', () => {
  it('Join sends one kind:9021 naming the team, signed by the person joining', async () => {
    expect(await actions().joinTeam(TEAM)).toEqual({ ok: true })
    const [join] = relay.sentOf(9021)
    expect(join.pubkey).toBe(ME)
    expect(tagOf(join, 'h')).toBe(TEAM)
    expect(relay.sentOf(9022, 9000)).toHaveLength(0)
  })

  it('Leave sends one kind:9022 naming the team', async () => {
    expect(await actions().leaveTeam(TEAM)).toEqual({ ok: true })
    const [leave] = relay.sentOf(9022)
    expect(leave.pubkey).toBe(ME)
    expect(tagOf(leave, 'h')).toBe(TEAM)
    expect(relay.sentOf(9021)).toHaveLength(0)
  })

  it('Add sends a kind:9000 naming the team and the person added, and nobody else', async () => {
    expect(await actions().addToTeam(TEAM, KATERINA)).toEqual({ ok: true })
    const [add] = relay.sentOf(9000)
    expect(tagOf(add, 'h')).toBe(TEAM)
    expect(tagsOf(add, 'p')).toEqual([KATERINA])
  })

  it('a refused join is said, and nothing claims it worked', async () => {
    relay.refuse({ when: (event) => event.kind === 9021, message: 'blocked: team is not open' })
    const result = await actions().joinTeam(TEAM)
    expect(result).toEqual({ ok: false, reason: 'You did not join the team. Try again.' })
  })
})

describe('marking a space, at the wire', () => {
  it('Make it a space sends a kind:1852 add of the topic with the space role', async () => {
    expect(await actions().markSpace(TEAM, TOPIC, true)).toEqual({ ok: true })
    const [mark] = relay.sentOf(1852)
    expect(tagOf(mark, 'h')).toBe(TEAM)
    expect(tagOf(mark, 'op')).toBe('add')
    expect(mark.tags.find((t) => t[0] === 'a' && t[1] === TOPIC)?.[3]).toBe('space')
  })

  it('Not a space sends the same add with no role', async () => {
    expect(await actions().markSpace(TEAM, TOPIC, false)).toEqual({ ok: true })
    const [unmark] = relay.sentOf(1852)
    const entry = unmark.tags.find((t) => t[0] === 'a' && t[1] === TOPIC)
    expect(entry).toBeDefined()
    expect(entry?.[3]).not.toBe('space')
  })
})

describe('following a team, at the wire', () => {
  const listOn = (teams: Record<string, number>) =>
    signed({ kind: 30078, created_at: 1_700_000_000, tags: [['d', TEAMS_D_TAG]], content: `fake-nip44:${Buffer.from(serializeTeamsBlob({ teams, off: ['x'] }, 1)).toString('base64')}` })

  it('Follow writes the whole private list with the team added, keeping what it held', async () => {
    relay.seed(listOn({ [OTHER]: 5 }))
    expect(await actions().followTeam(TEAM, true)).toEqual({ ok: true })
    const [list] = relay.sentOf(30078)
    expect(list.pubkey).toBe(ME)
    expect(tagOf(list, 'd')).toBe(TEAMS_D_TAG)
    const written = parseTeamsBlob(relay.decrypt(list.content))
    expect(Object.keys(written?.teams ?? {}).sort()).toEqual([TEAM, OTHER].sort())
    expect(written?.teams[OTHER]).toBe(5)
    expect(written?.off).toEqual(['x'])
  })

  it('Unfollow writes the list without the team', async () => {
    relay.seed(listOn({ [TEAM]: 5, [OTHER]: 6 }))
    expect(await actions().followTeam(TEAM, false)).toEqual({ ok: true })
    const written = parseTeamsBlob(relay.decrypt(relay.sentOf(30078)[0].content))
    expect(Object.keys(written?.teams ?? {})).toEqual([OTHER])
  })

  it('a list that is there and cannot be read is never written over', async () => {
    relay.seed(signed({ kind: 30078, tags: [['d', TEAMS_D_TAG]], content: 'not-a-fake-cipher' }))
    const result = await actions().followTeam(TEAM, true)
    expect(result.ok).toBe(false)
    expect(relay.sentOf(30078)).toHaveLength(0)
  })
})
