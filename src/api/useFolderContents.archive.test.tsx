/**
 * What the Archive view lists in a Folder — PEE-58.
 *
 * A Folder read with `includeArchived` finds the archived files the Folder
 * lists. An issue is listed by its project, never by a Folder, so an issue
 * archived on its own under a live project was in no list at all: Katerina
 * opened one and Archive showed it open, selected nowhere (28 October). What
 * is pinned here is that Archive asks the live projects for theirs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { KIND_BARE_FILE, type FolderContents, type ForeignObject } from '@estiva-app/interop'

const seam = vi.hoisted(() => ({
  resolveFolderContents: vi.fn<(folder: string, options?: { includeArchived?: boolean }) => Promise<FolderContents>>(),
  resolveFolderContentsFromDevice: vi.fn(async () => undefined),
  archivedChildren: vi.fn<(parents: readonly string[]) => Promise<ForeignObject[]>>(),
}))
vi.mock('@/api', () => ({ useForeignObjects: () => seam }))
vi.mock('@/nostr/freshness', () => ({ recordReadFailure: vi.fn() }))

import { useFolderContents } from './useFolderContents'

const FOLDER = 'team'
const PROJECT = '30850:aa:project'
const ARCHIVED_PROJECT = '30850:aa:old-project'
const file = (address: string, kind: number, more: Partial<ForeignObject> = {}) =>
  ({ ref: address, address, kind, slots: { title: { value: address } }, ...more }) as unknown as ForeignObject
const ARCHIVE = { by: 'bb', at: 1 }

const project = file(PROJECT, 30850, { listsChildren: true })
const archivedProject = file(ARCHIVED_PROJECT, 30850, { listsChildren: true, archived: ARCHIVE })
const liveTopic = file(`${KIND_BARE_FILE}:aa:live`, KIND_BARE_FILE)
const archivedTopic = file(`${KIND_BARE_FILE}:aa:gone`, KIND_BARE_FILE, { archived: ARCHIVE })
const archivedIssue = file('30851:aa:done', 30851, { parentRef: PROJECT, archived: ARCHIVE })

const settle = () => act(async () => {})
const drawn = (state: unknown) => (state as FolderContents).files.map((f) => f.ref)

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  seam.resolveFolderContents.mockReset()
  seam.archivedChildren.mockReset()
  seam.resolveFolderContents.mockResolvedValue({
    id: FOLDER,
    hasState: true,
    source: 'state',
    files: [project, archivedProject, liveTopic, archivedTopic],
  })
  seam.archivedChildren.mockResolvedValue([archivedIssue])
})

describe('the Archive view’s read of a Folder', () => {
  it('lists an issue archived on its own under a live project, after what the Folder lists (PEE-58)', async () => {
    const { result } = renderHook(() => useFolderContents(FOLDER, { archived: true }))
    await settle()
    expect(drawn(result.current.state)).toEqual([ARCHIVED_PROJECT, archivedTopic.ref, archivedIssue.ref])
    // Only the live project is asked: an archived one is drawn with what went with it.
    expect(seam.archivedChildren).toHaveBeenCalledWith([PROJECT], undefined)
  })

  it('asks nothing more of a Folder that is itself archived: everything in it is drawn already', async () => {
    const { result } = renderHook(() => useFolderContents(FOLDER, { archived: true, folderArchived: true }))
    await settle()
    expect(drawn(result.current.state)).toEqual([PROJECT, ARCHIVED_PROJECT, liveTopic.ref, archivedTopic.ref])
    expect(seam.archivedChildren).not.toHaveBeenCalled()
  })
})
