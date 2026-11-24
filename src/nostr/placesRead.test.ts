/**
 * What opening a place asks the relay for (ALL-5): of the place's changes,
 * only the ones naming a person, so its renames, file-list entries and saves
 * are not downloaded to draw the follow switch and Who follows.
 */
import { describe, expect, it } from 'vitest'
import type { SignedEvent } from '@estiva-app/protocol'
import type { Place } from '@estiva-app/conversation'
import { readPlace } from './places'

const ME = 'b'.repeat(64)
const KATERINA = 'c'.repeat(64)
const MIKY = 'a'.repeat(64)
const TEAM = '33333333-3333-4333-8333-333333333333'
const TOPIC = `30840:${MIKY}:d68a8c78-5ec7-4652-b236-89ab57ac5b1e`
const place: Place = { address: TOPIC, team: TEAM }

/** A relay that keeps every filter it was asked and answers nothing. */
function relay() {
  const asked: Record<string, unknown>[] = []
  const query = (filters: Record<string, unknown>[]): Promise<SignedEvent[]> => {
    asked.push(...filters)
    return Promise.resolve([])
  }
  /** The filters that ask for the place's changes. */
  const changeFilters = () => asked.filter((f) => (f.kinds as number[]).includes(1851) && (f['#a'] as string[] | undefined)?.includes(TOPIC))
  return { query, changeFilters }
}
const noDecrypt = () => Promise.resolve(undefined)

describe('what opening a place reads of its changes', () => {
  it('asks only for the changes naming the viewer or someone with a profile', async () => {
    const { query, changeFilters } = relay()
    await readPlace(place, ME, query, noDecrypt, [KATERINA, MIKY, KATERINA])
    expect(changeFilters()).toEqual([{ kinds: [1851], '#a': [TOPIC], '#p': [MIKY, ME, KATERINA] }])
  })

  it("asks only for the viewer's own for a row's Leave or Join", async () => {
    const { query, changeFilters } = relay()
    await readPlace(place, ME, query, noDecrypt, [])
    expect(changeFilters()).toEqual([{ kinds: [1851], '#a': [TOPIC], '#p': [ME] }])
  })
})
