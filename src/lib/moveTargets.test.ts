import { describe, expect, it } from 'vitest'
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'
import { currentFolderOf, listedUnder, moveTargetsIn } from './moveTargets'

const PK = 'a'.repeat(64)
const file = (kind: number, d: string, extra: Partial<ForeignObject> = {}) =>
  ({
    ref: `${kind}:${PK}:${d}`,
    address: `${kind}:${PK}:${d}`,
    kind,
    slots: { title: { value: d } },
    actions: [],
    ...extra,
  }) as unknown as ForeignObject

const project = file(30850, 'project', { folder: 'record' })
const other = file(30850, 'other')
const topic = file(30840, 'topic', { folder: 'hq', parentField: 'parent' })
const sub = file(30840, 'sub', { folder: 'hq', parentRef: topic.address, parentField: 'parent' })
const subsub = file(30840, 'subsub', { folder: 'hq', parentRef: sub.address, parentField: 'parent' })
const issue = file(30851, 'issue', { folder: 'record', parentRef: project.address, parentField: 'project', parentKind: 30850 })
const underIssue = file(30840, 'under-issue', { folder: 'hq', parentRef: issue.address })

const hq = { id: 'hq', name: 'HQ', hasState: true, addresses: [project.address!, topic.address!, sub.address!] } as FolderSummary
const steer = { id: 'steer', name: 'Steer', hasState: true, addresses: [other.address!] } as FolderSummary
const record = { id: 'record', hasState: false, listedIn: ['hq'] } as FolderSummary

describe('currentFolderOf (FOL-45)', () => {
  const folders = [hq, steer, record]
  const teams = [hq, steer]

  it('is the team whose state lists the file, not its `h`', () => {
    expect(currentFolderOf(topic, folders, teams)).toBe('hq')
    // Filed in HQ, moved to Steer by its listing: its `h` still says HQ.
    const after = [{ ...hq, addresses: [] }, { ...steer, addresses: [topic.address!] }]
    expect(currentFolderOf(topic, folders, after)).toBe('steer')
  })

  it('is a nested Folder that lists it, not the team that Folder is in', () => {
    const nested = { id: 'nested', hasState: true, listedIn: ['hq'], addresses: [`30840:${PK}:deep`] } as FolderSummary
    const deep = file(30840, 'deep', { folder: 'nested' })
    expect(currentFolderOf(deep, [...folders, nested], teams)).toBe('nested')
  })

  it('is its project’s team for an issue, which no state lists', () => {
    expect(currentFolderOf(issue, folders, teams)).toBe('hq')
    expect(currentFolderOf({ ...issue, parentRef: other.address }, folders, teams)).toBe('steer')
  })

  it('falls back to the team its own Folder is listed in, then to that Folder', () => {
    expect(currentFolderOf({ ...project, address: `30850:${PK}:unlisted` }, folders, teams)).toBe('hq')
    expect(currentFolderOf({ ...topic, address: `30840:${PK}:unlisted`, folder: 'somewhere' }, folders, teams)).toBe('somewhere')
  })
})

describe('listedUnder (FOL-45)', () => {
  it('is everything under the file however deep, and never the file', () => {
    expect(listedUnder([topic, sub, subsub, project], topic)).toEqual([sub.address, subsub.address])
  })

  it('finds what is under an issue, although the issue is not in the listing', () => {
    expect(listedUnder([topic, underIssue], issue)).toEqual([underIssue.address])
  })
})

describe('moveTargetsIn (FOL-45)', () => {
  it('in its own Folder, offers only real moves: never itself, what is under it, or where it is', () => {
    const targets = moveTargetsIn([project, topic, sub, subsub], sub, { sameFolder: true })
    // `sub` is under `topic` now, so the top is a move and `topic` is not.
    expect(targets.map((t) => t.file?.address ?? 'top')).toEqual(['top', project.address])
  })

  it('in another Folder, offers a topic the top and every file there', () => {
    const targets = moveTargetsIn([other], topic, { sameFolder: false })
    expect(targets.map((t) => t.file?.address ?? 'top')).toEqual(['top', other.address])
  })

  it('in another Folder, offers an issue only that Folder’s projects — no project is in no Folder', () => {
    const targets = moveTargetsIn([other, file(30840, 'a-topic')], issue, { sameFolder: false })
    expect(targets.map((t) => t.file?.address ?? 'top')).toEqual([other.address])
  })
})
