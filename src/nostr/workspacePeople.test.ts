/*
  Who People lists (REM-3): the roster, named by profiles, humans only.

  The shapes are production's, read 2026-09-24: a relay-signed `13534` with a
  `-` (NIP-70) tag and one `member` per admitted key, and Estiva ID's `kind:0`s.
*/
import { describe, expect, it } from 'vitest'
import { workspaceFilters, workspacePeopleOf } from './workspacePeople'

const ME = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const MIKY = 'f3a38fa646debd4162125e0aed87b6d2393fb1ed9702b6875dcbc0c6529d64d1'
const KATERINA = 'a8a7d73900000000000000000000000000000000000000000000000000000000'
const AGENT = 'cb77583e00000000000000000000000000000000000000000000000000000000'
const NAMELESS = '88ac6aae00000000000000000000000000000000000000000000000000000000'
const OUTSIDER = 'f1471e4800000000000000000000000000000000000000000000000000000000'
const LEFT = '0a59298600000000000000000000000000000000000000000000000000000000'

const roster = (members: string[], created_at = 100) => ({
  id: `r${created_at}`,
  pubkey: '8b75a34d00000000000000000000000000000000000000000000000000000000',
  created_at,
  kind: 13534,
  tags: [['-'], ...members.map((m) => ['member', m])],
  content: '',
  sig: 'x',
})

const profile = (pubkey: string, content: Record<string, unknown>, created_at = 100) => ({
  id: `p${pubkey.slice(0, 8)}${created_at}`,
  pubkey,
  created_at,
  kind: 0,
  tags: [],
  content: JSON.stringify(content),
  sig: 'x',
})

const people = [
  profile(MIKY, { display_name: 'Miky', name: 'Miky', nip05: 'miky@estiva.estiva.app', picture: 'https://id.estiva.app/avatar/m.jpg' }),
  profile(KATERINA, { display_name: 'Katerina Kelepouri', name: 'Katerina Kelepouri' }),
  profile(ME, { display_name: 'Claude (steered by Miky)', name: 'Claude (steered by Miky)' }),
  profile(AGENT, { display_name: 'Claude (steered by Katerina)', bot: true }),
  profile(OUTSIDER, { name: 'PEEK-72 renamed' }),
  profile(LEFT, { name: 'Somebody who left' }),
]

describe('who People lists', () => {
  it('reads the roster and every profile in one request', () => {
    expect(workspaceFilters()).toEqual([
      { kinds: [13534], limit: 1 },
      { kinds: [0], limit: 500 },
    ])
  })

  it('lists roster members with a profile, by name, never the viewer', () => {
    const out = workspacePeopleOf([roster([MIKY, KATERINA, ME, NAMELESS]), ...people], ME)
    expect(out).toEqual([
      { pubkey: KATERINA, name: 'Katerina Kelepouri' },
      { pubkey: MIKY, name: 'Miky', picture: 'https://id.estiva.app/avatar/m.jpg' },
    ])
  })

  it('leaves out a profile marked bot (NIP-24) even on the roster', () => {
    const out = workspacePeopleOf([roster([MIKY, AGENT]), ...people], ME)
    expect(out.map((p) => p.pubkey)).toEqual([MIKY])
  })

  it('leaves out a profile that is not on the roster, unless the viewer has a DM with them', () => {
    const events = [roster([MIKY]), ...people]
    expect(workspacePeopleOf(events, ME).map((p) => p.pubkey)).toEqual([MIKY])
    expect(workspacePeopleOf(events, ME, [LEFT]).map((p) => p.pubkey)).toEqual([MIKY, LEFT])
  })

  it('reads the newest roster and the newest profile only', () => {
    const events = [roster([KATERINA], 50), roster([MIKY], 200), profile(MIKY, { name: 'Old name' }, 50), ...people]
    expect(workspacePeopleOf(events, ME)).toEqual([
      { pubkey: MIKY, name: 'Miky', picture: 'https://id.estiva.app/avatar/m.jpg' },
    ])
  })

  it('with no roster at all, everyone with a profile is a member', () => {
    expect(workspacePeopleOf(people, ME).map((p) => p.name)).toEqual(['Katerina Kelepouri', 'Miky', 'PEEK-72 renamed', 'Somebody who left'])
  })

  it('skips a profile it cannot parse or that has no name, rather than losing the rest', () => {
    const broken = { ...profile(KATERINA, {}), content: '{not json' }
    const out = workspacePeopleOf([roster([MIKY, KATERINA, NAMELESS]), broken, profile(NAMELESS, { name: ' ' }), people[0]], ME)
    expect(out.map((p) => p.pubkey)).toEqual([MIKY])
  })
})
