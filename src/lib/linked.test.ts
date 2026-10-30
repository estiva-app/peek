/**
 * What a link stands for, as the kit draws it (`linkStateOf`): a message's
 * words read an app link as what it names once that has come back, never the
 * raw URL (widget review, item 20); a file that cannot be read reads as the URL
 * it was written as (item 58); a file a trusted deletion names says "deleted"
 * (item 56).
 */
import { describe, expect, it, vi } from 'vitest'
import type { ForeignObject } from '@estiva-app/interop'
import { encodeNevent, addrToNaddr } from '@estiva-app/protocol'

const ISSUE_URL = 'https://ship.estiva.app/issue/plan-the-launch-b389d20f'
const ISSUE = `30851:${'a'.repeat(64)}:b389d20f`
vi.mock('@/api/foreign', () => ({ knownCardValue: (url: string) => (url === ISSUE_URL ? ISSUE : undefined) }))
vi.mock('@/api/mentions', () => ({ personByPubkey: () => undefined }))

const { linkStateOf } = await import('./linked')

const ADA = 'b'.repeat(64)
const MESSAGE = `nostr:${encodeNevent({ id: 'c'.repeat(64), relays: [], kind: 9 })}`
const message = (body: string) =>
  ({
    ref: MESSAGE,
    eventId: 'c'.repeat(64),
    kind: 9,
    widget: ['message', 'card'],
    slots: { title: { value: ADA, isPubkey: true }, body: { value: body } },
    people: { [ADA]: { displayName: 'Ada Lovelace' } },
    meta: [],
    comments: [],
    actions: [],
  }) as unknown as ForeignObject

describe('a message’s words in its preview', () => {
  it('read an app link as what it names once that has come back, never the raw URL', () => {
    const link = linkStateOf(MESSAGE, message(`Look at ${ISSUE_URL} first`))
    expect(link.state === 'ready' && link.linked.body).toBe('Look at Issue first')
  })

  it('keep a link nothing has answered for as written', () => {
    const link = linkStateOf(MESSAGE, message('Look at https://example.com/x first'))
    expect(link.state === 'ready' && link.linked.body).toContain('https://example.com/x')
  })
})

describe('a file that came back as nothing', () => {
  const uri = `nostr:${addrToNaddr(ISSUE, [])}`

  it('reads as the URL it was written as', () => {
    expect(linkStateOf(uri, null, { url: ISSUE_URL })).toMatchObject({ state: 'unavailable', url: ISSUE_URL })
  })

  it('has no URL to read as when it was written as its reference', () => {
    expect(linkStateOf(uri, null, { url: uri })).not.toHaveProperty('url')
  })

  it('says it was deleted when a trusted deletion names it', () => {
    expect(linkStateOf(uri, null, { deleted: true })).toMatchObject({ state: 'unavailable', deleted: true })
  })
})
