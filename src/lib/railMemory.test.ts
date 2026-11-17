// @vitest-environment jsdom
/**
 * Where the rail's items come back to, kept in this tab so a reload keeps it
 * (Katerina, 17 November: "no matter what"). What is read back is checked:
 * a stored value is only ever an app path, a DM id or a Desk query.
 */
import { describe, expect, it } from 'vitest'
import { clearRailMemory, keepRailMemory, NO_RAIL_MEMORY, readRailMemory } from './railMemory'

const KEY = 'peek.rail.last'

describe('railMemory', () => {
  it('reads back what was kept', () => {
    const memory = {
      dmId: 'f00d',
      topicsPath: '/topic/release-notes-abc?thread=e1',
      foldersPath: '/app/teams/team-1',
      desk: { search: '?open=30851%3Aabc', dm: { dmId: 'f00d', dmName: 'Ada', section: 'urgent' }, openedFrom: { section: 'openWork', title: 'Release' } },
    }
    keepRailMemory(memory)
    expect(readRailMemory()).toEqual(memory)
  })

  it('reads nothing when nothing was kept, and after sign-out', () => {
    expect(readRailMemory()).toEqual(NO_RAIL_MEMORY)
    keepRailMemory({ ...NO_RAIL_MEMORY, topicsPath: '/app/initiatives' })
    clearRailMemory()
    expect(readRailMemory()).toEqual(NO_RAIL_MEMORY)
  })

  it('drops what is not an app path, a DM id or a Desk query', () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ dmId: 7, topicsPath: '//elsewhere.example/topic', foldersPath: 'https://elsewhere.example', desk: { search: 'open=1', dm: { dmId: 'f00d' } } }),
    )
    expect(readRailMemory()).toEqual(NO_RAIL_MEMORY)
  })

  it('keeps a Desk query but not a DM it cannot draw', () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ desk: { search: '', dm: { dmId: 'f00d' } } }))
    expect(readRailMemory().desk).toEqual({ search: '' })
  })

  it('reads nothing from a value that is not JSON', () => {
    window.sessionStorage.setItem(KEY, '{not json')
    expect(readRailMemory()).toEqual(NO_RAIL_MEMORY)
  })
})
