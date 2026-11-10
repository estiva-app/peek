import { describe, it, expect } from 'vitest'
import type { FolderSummary } from '@estiva-app/interop'
import type { StreamMessage } from '@/nostr/channelStreams'
import { placeStreams, teamHasMemberStream, unlistedFiles } from './teamUnread'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const THEM = 'd'.repeat(64)
const PK = 'b'.repeat(64)
const FOL16 = `30851:${PK}:fol-16`
const FOL18 = `30851:${PK}:fol-18`
const NOW = 1_800_000_000

const said = (id: string, at: number, about: string[] = [], by = THEM): StreamMessage => ({
  id,
  at,
  by,
  root: id,
  about,
  urgent: false,
  body: '',
})
describe('teamHasMemberStream — does this Folder hold a file the person is a member of', () => {
  const only =
    (...keys: string[]) =>
    (key: string) =>
      keys.includes(key)

  it('is true when a message names a file the person is a member of', () => {
    expect(teamHasMemberStream([said('m', NOW - 10, [FOL18])], only(FOL18))).toBe(true)
  })

  it('is false when the talk in it is about files the person is not in', () => {
    expect(teamHasMemberStream([said('m', NOW - 10, [FOL18])], only(FOL16))).toBe(false)
  })

  /* A Folder has nothing to read (Miky, 2026-10-01): its own chat is not a file, so it is never an answer. */
  it('is false for a Folder with only chat, whatever the person is a member of', () => {
    expect(teamHasMemberStream([said('m', NOW - 10)], () => true)).toBe(false)
  })

  /*
    The limit, written down: a file the person is in that nobody has said
    anything in leaves no trace in these streams, so its Folder is not one of
    the answers. `All` is the recovery, and the Folder is one click away in it.
  */
  it('cannot see a file the person is in that has no messages', () => {
    expect(teamHasMemberStream([], only(FOL18))).toBe(false)
  })

  /* An `a` that is not an address names no stream — `teamHasUnread`'s rule. */
  it('ignores an `a` that is not an address', () => {
    expect(teamHasMemberStream([said('m', NOW - 10, ['not-an-address'])], () => true)).toBe(false)
  })
})

/*
  FOL-49. A project moved from A to B by `kind:1852` keeps its conversation in
  A's channel, so the read by `h` hands its comments to A. The done-when is the
  first block: they light B for a follower of the project, and not A.
*/
describe('placeStreams — a moved file is judged where its Folder lists it', () => {
  const A = FOLDER
  const B = '22222222-2222-4222-8222-222222222222'
  const RECORD = '33333333-3333-4333-8333-333333333333'
  const PROJECT = `30850:${PK}:project`
  const folder = (id: string, hasState: boolean, addresses?: string[]): FolderSummary => ({
    id,
    hasState,
    ...(addresses ? { addresses } : {}),
  })
  const place = (...args: Parameters<typeof placeStreams>) => placeStreams(...args).streams

  it('puts the talk in the Folder the project moved to, and not the one it was talked in', () => {
    const placed = place({ [A]: [said('c', NOW - 10, [PROJECT])], [B]: [] }, [
      folder(A, true, []),
      folder(B, true, [PROJECT]),
    ])
    expect(placed[B].map((message) => message.id)).toEqual(['c'])
    expect(placed[A]).toEqual([])
  })

  it('keeps a file its own Folder still lists', () => {
    const held = { [A]: [said('c', NOW - 10, [PROJECT])], [B]: [] }
    const placed = place(held, [folder(A, true, [PROJECT]), folder(B, true, [])])
    expect(placed).toEqual(held)
  })

  /* Every issue: talked about under its project's `h`, and listed by no state. */
  it('keeps a file no state lists', () => {
    const held = { [A]: [said('c', NOW - 10, [FOL18])], [B]: [] }
    expect(place(held, [folder(A, true, []), folder(B, true, [PROJECT])])).toEqual(held)
  })

  /* A record channel has no state; `listedIn` already folds it into its team. */
  it('keeps talk in a Folder with no state', () => {
    const held = { [RECORD]: [said('c', NOW - 10, [PROJECT])], [B]: [] }
    expect(place(held, [folder(RECORD, false), folder(B, true, [PROJECT])])).toEqual(held)
  })

  it('splits a message about a moved file and one that stayed', () => {
    const placed = place({ [A]: [said('c', NOW - 10, [PROJECT, FOL16])], [B]: [] }, [
      folder(A, true, [FOL16]),
      folder(B, true, [PROJECT]),
    ])
    expect(placed[A].map((message) => message.about)).toEqual([[FOL16]])
    expect(placed[B].map((message) => message.about)).toEqual([[PROJECT]])
  })

  /* Not answered is not "nothing said": a moved message must not pass for a judged Folder. */
  it('moves nothing into a Folder the caller holds no messages for', () => {
    const placed = place({ [A]: [said('c', NOW - 10, [PROJECT])] }, [
      folder(A, true, []),
      folder(B, true, [PROJECT]),
    ])
    expect(placed[B]).toBeUndefined()
  })

  /* FOL-44's signal arrives by `h`; an open section under B must hear it too. */
  it('says which Folders a channel handed talk to, and none for talk that stayed', () => {
    const { handed } = placeStreams(
      { [A]: [said('c', NOW - 10, [PROJECT]), said('d', NOW - 5, [PROJECT])], [B]: [said('e', NOW - 5)] },
      [folder(A, true, []), folder(B, true, [PROJECT])],
    )
    expect(handed).toEqual({ [A]: [B] })
  })
})

/*
  FOL-50. An issue's comment carries only the issue's `a`, and no state lists an
  issue, so after its project moved from A to B it stayed in A. The done-when is
  the first block: it lights B for a follower of the issue, and not A.
*/
describe('placeStreams — an issue lives where its project does', () => {
  const A = FOLDER
  const B = '22222222-2222-4222-8222-222222222222'
  const PROJECT = `30850:${PK}:project`
  const OTHER = `30850:${PK}:other`
  const folder = (id: string, hasState: boolean, addresses?: string[]): FolderSummary => ({
    id,
    hasState,
    ...(addresses ? { addresses } : {}),
  })
  const moved = [folder(A, true, [OTHER]), folder(B, true, [PROJECT])]

  it('puts an issue’s talk in the Folder its project moved to, and not the old one', () => {
    const { streams } = placeStreams({ [A]: [said('c', NOW - 10, [FOL18])], [B]: [] }, moved, { [FOL18]: PROJECT })
    expect(streams[B].map((message) => message.id)).toEqual(['c'])
    expect(streams[A]).toEqual([])
  })

  it('hands over the issue’s own stream — its address', () => {
    const { streams, handed } = placeStreams({ [A]: [said('c', NOW - 10, [FOL18])], [B]: [] }, moved, {
      [FOL18]: PROJECT,
    })
    expect(streams[B].map((message) => message.about)).toEqual([[FOL18]])
    expect(handed).toEqual({ [A]: [B] })
  })

  it('keeps an issue whose project its Folder still lists', () => {
    const held = { [A]: [said('c', NOW - 10, [FOL18])], [B]: [] }
    expect(placeStreams(held, moved, { [FOL18]: OTHER }).streams).toEqual(held)
  })

  it('keeps an issue until its parent is known, at the top, or under a project no state lists', () => {
    const held = { [A]: [said('c', NOW - 10, [FOL18])], [B]: [] }
    for (const parents of [{}, { [FOL18]: null }, { [FOL18]: `30850:${PK}:nowhere` }]) {
      expect(placeStreams(held, moved, parents).streams).toEqual(held)
    }
  })

  /* The rule is the parent's, not the kind's: a topic nested under a project is drawn under it. */
  it('moves talk about a topic nested under the moved project too', () => {
    const TOPIC = `39000:${PK}:44444444-4444-4444-8444-444444444444`
    const { streams } = placeStreams({ [A]: [said('c', NOW - 10, [TOPIC])], [B]: [] }, moved, { [TOPIC]: PROJECT })
    expect(streams[A]).toEqual([])
    expect(streams[B].map((message) => message.about)).toEqual([[TOPIC]])
  })

  it('splits a comment about a moved issue and an issue that stayed', () => {
    const { streams } = placeStreams({ [A]: [said('c', NOW - 10, [FOL18, FOL16])], [B]: [] }, moved, {
      [FOL18]: PROJECT,
      [FOL16]: OTHER,
    })
    expect(streams[A].map((message) => message.about)).toEqual([[FOL16]])
    expect(streams[B].map((message) => message.about)).toEqual([[FOL18]])
  })
})

describe('unlistedFiles — what placeStreams needs a parent for', () => {
  const B = '22222222-2222-4222-8222-222222222222'
  const RECORD = '33333333-3333-4333-8333-333333333333'
  const PROJECT = `30850:${PK}:project`

  it('asks about files named in a Folder with state that no state lists, once each', () => {
    const held = {
      [FOLDER]: [said('c', NOW - 10, [FOL18, PROJECT]), said('d', NOW - 5, [FOL18, 'not an address'])],
      [B]: [said('e', NOW - 5, [FOL16])],
    }
    expect(unlistedFiles(held, [{ id: FOLDER, hasState: true, addresses: [PROJECT] }, { id: B, hasState: true }])).toEqual([
      FOL16,
      FOL18,
    ])
  })

  it('asks nothing of a Folder with no state, which nothing is moved out of', () => {
    expect(unlistedFiles({ [RECORD]: [said('c', NOW - 10, [FOL18])] }, [{ id: RECORD, hasState: false }])).toEqual([])
  })
})
