/**
 * What Teams draws first goes out first (ALO-14). The navigation's Folder
 * listing and the teams read are each two or three REQs, and on a cold open
 * they were asked while a second's twelve frames of other reads filled the
 * shaper: 1.0–1.4 s held before going out, for reads the relay answers in under
 * 0.1 s. They ask in the first-page lane (PEE-7), which `socketRead.test.ts`
 * shows going out ahead of reads already waiting; a load a write or a dialog
 * passes in keeps its own lane.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryRelay } = vi.hoisted(() => ({ queryRelay: vi.fn() }))
vi.mock('./bridge', () => ({ queryRelay, publishSigned: vi.fn(), signViaEstivaId: vi.fn() }))

import { firstReadQuery, folderLoadAsViewer, listFoldersAsViewer } from './foreign'
import { readTeamsAsViewer } from './teams'

const VIEWER = 'b'.repeat(64)
const token = { accessToken: 't', pubkey: VIEWER } as never
const TEAM = '33333333-3333-4333-8333-333333333333'
const lanes = () => queryRelay.mock.calls.map((call) => call[4])

beforeEach(() => {
  queryRelay.mockReset()
  queryRelay.mockResolvedValue({ ok: true, events: [] })
})

describe('the reads Teams draws first', () => {
  it('lists the Folders in the first-page lane', async () => {
    await listFoldersAsViewer('https://relay.test', token)
    expect(queryRelay).toHaveBeenCalled()
    expect(new Set(lanes())).toEqual(new Set(['first']))
  })

  it('reads the teams in the first-page lane', async () => {
    await readTeamsAsViewer([TEAM], [], 'https://relay.test', token)
    expect(queryRelay).toHaveBeenCalled()
    expect(new Set(lanes())).toEqual(new Set(['first']))
  })

  it('sends a first read wider than one REQ in a click’s lane, where it waits for a slot', async () => {
    const wide = Array.from({ length: 11 }, (_, i) => ({ kinds: [30890], '#d': [`f${i}`] }))
    await firstReadQuery('https://relay.test', token)(wide)
    await firstReadQuery('https://relay.test', token)(wide.slice(0, 10))
    expect(lanes()).toEqual(['click', 'first'])
  })

  it("leaves a listing that is part of another load in that load's lane", async () => {
    await listFoldersAsViewer('https://relay.test', token, 'relay', folderLoadAsViewer('https://relay.test', token))
    expect(queryRelay).toHaveBeenCalled()
    expect(lanes()).not.toContain('first')
  })
})
