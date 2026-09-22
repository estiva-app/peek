/**
 * What the relay implies a person follows (FOL-30): the filter, and the key
 * each of the three naming events yields.
 */
import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import { IMPLIED_FOLLOWS_LIMIT, impliedFollowsFilter, impliedKeyOf, impliedKeysOf } from './impliedFollows'
import { PEEK_HORIZON_DAYS } from './readState'

const ME = 'c'.repeat(64)
const THEM = 'd'.repeat(64)
const PK = 'b'.repeat(64)
const ISSUE = `30851:${PK}:d4d3f511-f10f-4413-9123-fb3f9b00bc92`
const PROJECT = `30850:${PK}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`
const TOPIC = `30840:${PK}:0a2e4f9b-2f1c-4a52-9c0f-5f0e9b0e1a11`
const FOLDER = '11111111-1111-4111-8111-111111111111'
const NOW = 1_800_000_000

const event = (kind: number, tags: string[][], pubkey = THEM): SignedEvent =>
  ({ id: 'e'.repeat(64), pubkey, created_at: NOW - 10, kind, tags, content: '', sig: '' }) as SignedEvent

describe('the filter', () => {
  it('asks for the three kinds that name a person about a file, by #p, inside the horizon', () => {
    expect(impliedFollowsFilter(ME, NOW)).toEqual({
      kinds: [1111, 9, 1851],
      '#p': [ME],
      since: NOW - PEEK_HORIZON_DAYS * 24 * 60 * 60,
      limit: IMPLIED_FOLLOWS_LIMIT,
    })
  })
})

describe('the key each event implies', () => {
  it('a comment implies the file its A names', () => {
    expect(impliedKeyOf(event(1111, [['A', ISSUE], ['p', ME], ['h', FOLDER]]))).toBe(ISSUE)
  })

  it('a topic message implies the topic Folder its h names', () => {
    expect(impliedKeyOf(event(9, [['h', FOLDER], ['p', ME]]))).toBe(FOLDER)
  })

  it('a placement implies the issue or project its a names (ship#169)', () => {
    expect(impliedKeyOf(event(1851, [['a', ISSUE], ['field', 'assignee'], ['value', ME], ['h', FOLDER], ['p', ME]]))).toBe(ISSUE)
    expect(impliedKeyOf(event(1851, [['a', PROJECT], ['field', 'lead'], ['value', ME], ['h', FOLDER], ['p', ME]]))).toBe(PROJECT)
  })

  it('implies nothing for an anchor nobody could follow, or a kind it does not know', () => {
    expect(impliedKeyOf(event(1111, [['A', 'not an address'], ['p', ME]]))).toBeUndefined()
    expect(impliedKeyOf(event(1111, [['p', ME]]))).toBeUndefined()
    expect(impliedKeyOf(event(9, [['h', 'not a uuid'], ['p', ME]]))).toBeUndefined()
    expect(impliedKeyOf(event(7, [['p', ME]]))).toBeUndefined()
  })

  it('folds a read into one set of keys, however many events name each', () => {
    const keys = impliedKeysOf([
      event(1111, [['A', ISSUE], ['p', ME]]),
      event(1111, [['A', ISSUE], ['p', ME]]),
      event(1111, [['A', TOPIC], ['p', ME]]),
      event(9, [['h', FOLDER], ['p', ME]]),
      event(1851, [['a', PROJECT], ['field', 'lead'], ['value', ME], ['p', ME]]),
      event(7, [['p', ME]]),
    ])
    expect([...keys.keys()].sort()).toEqual([ISSUE, TOPIC, PROJECT, FOLDER].sort())
  })

  it('keeps the newest naming per key, in epoch ms — what a mute is judged against', () => {
    const at = (seconds: number) => ({ ...event(1111, [['A', ISSUE], ['p', ME]]), created_at: seconds })
    expect(impliedKeysOf([at(NOW - 100), at(NOW - 10), at(NOW - 50)]).get(ISSUE)).toBe((NOW - 10) * 1000)
  })
})
