/**
 * PEE-4 — matching, and the empty state that has to tell two silences apart.
 *
 * The wording assertions here look fussy and are the ticket's done-when: *"the
 * empty state distinguishes 'nothing matched' from 'nothing you can read'"*.
 * Those were one sentence before, and one sentence is what made a refused read
 * indistinguishable from an empty one everywhere else in this app (PEE-10).
 */
import { describe, expect, it } from 'vitest'
import type { Person } from '@/data/peopleData'
import {
  hasCompleteWord,
  snippetAround,
  matchPeople,
  messageEmptyState,
  normalizeQuery,
  type MessageSearchState,
} from './launcherSearch'

const PEOPLE: Person[] = [
  { id: 'alice', name: 'Alice Johnson', role: 'Product Designer' },
  { id: 'daniel', name: 'Daniel Stanton', role: 'Backend Engineer' },
  { id: 'juan', name: 'Juan Foley', role: 'Frontend Engineer' },
]

describe('normalizeQuery', () => {
  it('trims and lowercases, so every matcher agrees on the term', () => {
    expect(normalizeQuery('  Pipeline  ')).toBe('pipeline')
  })
})

describe('matchPeople', () => {
  it('matches a name fragment', () => {
    expect(matchPeople(PEOPLE, 'john').map((p) => p.id)).toEqual(['alice'])
  })

  it('matches a role, because that is where "designer" is written down', () => {
    expect(matchPeople(PEOPLE, 'designer').map((p) => p.id)).toEqual(['alice'])
    expect(matchPeople(PEOPLE, 'engineer').map((p) => p.id)).toEqual(['daniel', 'juan'])
  })
})

describe('hasCompleteWord', () => {
  it('is false for a single unfinished token — the common case while typing', () => {
    expect(hasCompleteWord('exam')).toBe(false)
    expect(hasCompleteWord('  exam  ')).toBe(false)
  })

  it('is true once there is a space, so at least one word is finished', () => {
    expect(hasCompleteWord('for example')).toBe(true)
  })
})

describe('messageEmptyState', () => {
  const done = (count: number): MessageSearchState => ({ kind: 'done', count })

  it('says nothing when there are results to show', () => {
    expect(messageEmptyState(done(3), 'example')).toBeNull()
  })

  it('says nothing before anything is typed', () => {
    expect(messageEmptyState({ kind: 'idle' }, '')).toBeNull()
  })

  it('blames the whole-word rule for a partial word, not the corpus', () => {
    /*
      Measured on production: "Cla" → 0 rows while "Claude" → 2. Reporting
      that as a flat "no messages matched" is a wrong statement about the
      workspace and is what would make this feature read as broken while
      behaving exactly as measured.
    */
    expect(messageEmptyState(done(0), 'Cla')).toBe(
      'No messages matched — message search needs a whole word.',
    )
  })

  it('states it plainly once a whole word genuinely found nothing', () => {
    expect(messageEmptyState(done(0), 'for zzqxvwmk')).toBe('No messages matched.')
  })

  it('distinguishes "nothing you can read" from "nothing matched"', () => {
    // The done-when, in one assertion. `not_a_member` is an answer arrived at
    // successfully, not an outage.
    expect(messageEmptyState({ kind: 'failed', failure: 'not_a_member' }, 'example')).toBe(
      'No messages you can read match — some conversations are not yours to see.',
    )
  })

  it('does not report a refusal as an empty result', () => {
    expect(messageEmptyState({ kind: 'failed', failure: 'refused' }, 'example')).toBe(
      'The relay refused the search, so this list is incomplete.',
    )
  })

  it('does not report an outage as a refusal', () => {
    // Retrying may work for one of these and not the other, which is why
    // RelayReadError classifies them rather than flattening them.
    expect(messageEmptyState({ kind: 'failed', failure: 'unreachable' }, 'example')).toBe(
      'Could not reach the relay, so messages are not included.',
    )
  })

  it('says there was nothing to ask with when signed out', () => {
    // Not "no messages matched": that would be a claim about a corpus nobody
    // searched.
    expect(messageEmptyState({ kind: 'signed-out' }, 'example')).toBe('Sign in to search messages.')
  })

  it('says it is working while it is working', () => {
    expect(messageEmptyState({ kind: 'searching' }, 'example')).toBe('Searching messages…')
  })
})

describe('snippetAround', () => {
  const long =
    'We shipped the read-state cutover on Monday and then, much later in a very long ' +
    'message that nobody wants to read all of, mentioned the pipeline exactly once.'

  it('centres the window on the match rather than truncating the start', () => {
    // The reason this is worth keeping from the dead prototype module: a hit
    // whose term is late in a long message shows none of it under a plain
    // `slice(0, 80)`.
    const snippet = snippetAround(long, 'pipeline')
    expect(snippet).toContain('pipeline')
    expect(snippet.startsWith('…')).toBe(true)
  })

  it('collapses whitespace, so a multi-line body stays one row', () => {
    expect(snippetAround('one\n\ntwo   three', 'two')).toBe('one two three')
  })

  it('falls back to the head of the text when the term is not in it', () => {
    // The `a` tag / stored-reference path can hand over a hit whose match is
    // not in the visible body; showing the opening beats showing nothing.
    expect(snippetAround('a short body', 'absent')).toBe('a short body')
  })
})
