// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import type { StreamMessage } from '@/nostr/channelStreams'
import { channelContext } from '@estiva-app/conversation'
import {
  type TeamUnreadObservation,
  type TeamUnreadProbe,
  type TeamUnreadSnapshot,
  installTeamUnreadDiagnostic,
  teamUnreadProbe,
} from './teamUnreadDiagnostic'

const FOLDER = '11111111-1111-4111-8111-111111111111'
const TEAM = '22222222-2222-4222-8222-222222222222'
const PK = 'b'.repeat(64)
const FILE = `30851:${PK}:fol-40`
const ME = 'c'.repeat(64)
const THEM = 'd'.repeat(64)
const NOW = 1_800_000_000
const HORIZON = 90 * 24 * 60 * 60

const said = (id: string, at: number, about: string[] = [], by = THEM): StreamMessage => ({
  id,
  at,
  by,
  root: id,
  about,
  urgent: false,
  body: '',
})

const observation = (over: Partial<TeamUnreadObservation> = {}): TeamUnreadObservation => ({
  ids: [FOLDER],
  folders: [{ id: FOLDER, name: 'Folders', listedIn: [TEAM] } as TeamUnreadObservation['folders'][number]],
  live: true,
  relayState: 'live',
  frontierReady: true,
  marker: () => undefined,
  merged: {},
  membership: 'known',
  termsOf: () => ({ member: true, muted: false }),
  isMentioned: () => false,
  me: ME,
  held: { at: NOW, streams: { [FOLDER]: [said('e1', NOW - 60)] } },
  horizonSeconds: HORIZON,
  result: { unread: { [FOLDER]: true, [TEAM]: true }, member: { [FOLDER]: true } },
  ...over,
})

/* Read the way a console reads it — through the installed global, so the
   installer is part of what these tests cover. */
const snapshot = (folder?: string): TeamUnreadSnapshot[] => {
  const read = (window as unknown as Record<string, unknown>).__teamUnread
  if (typeof read !== 'function') throw new Error('__teamUnread was not installed')
  return (read as (folder?: string) => TeamUnreadSnapshot[])(folder)
}

// Module-level registry: a probe left open leaks into the next test exactly as
// an unstopped watch leaks into the next tab.
const opened: TeamUnreadProbe[] = []
const open = () => {
  const probe = teamUnreadProbe()
  opened.push(probe)
  return probe
}
afterEach(() => {
  for (const probe of opened.splice(0)) probe.stop()
})

installTeamUnreadDiagnostic()

/*
  FOL-40. `__wideFilters()` proves a Folder's event reached the socket; this
  proves what the sidebar then did with it. The gates it reports are each a
  `continue` or an early return over a value that lives for one render.
*/
describe('the team unread probe', () => {
  it('reports one entry per mounted hook, and nothing once stopped', () => {
    const first = open()
    first.observe(observation())
    expect(snapshot()).toHaveLength(1)

    const second = open()
    second.observe(observation({ ids: [TEAM] }))
    expect(snapshot()).toHaveLength(2)

    first.stop()
    expect(snapshot()).toHaveLength(1)
    expect(snapshot()[0].folders).toBe(1)
  })

  it('answers before the hook has observed anything', () => {
    open()
    // Between the mount effect and the first commit there is nothing to say,
    // and a console call in that window must not throw.
    expect(snapshot()[0]).toMatchObject({ folders: 0, deliveries: 0, loads: 0, held: 0, heldAt: null })
  })

  it('names what asked for each re-read, and what came back', () => {
    const probe = open()
    probe.observe(observation())

    probe.loadStarted('folders')
    probe.loadSettled('ok', { answered: 81 })
    probe.delivered(FOLDER)
    probe.loadStarted('socket')

    const entry = snapshot()[0]
    expect(entry.deliveries).toBe(1)
    expect(entry.lastDelivery).toMatchObject({ folder: FOLDER, listed: true })
    expect(entry.loads).toBe(2)
    // The one in flight, not the one that finished: a re-read that never
    // settles is the shape a swallowed failure leaves behind.
    expect(entry.lastLoad).toMatchObject({ trigger: 'socket', outcome: 'pending' })
  })

  it('keeps the kind of a failed read', () => {
    const probe = open()
    probe.observe(observation())
    probe.loadStarted('socket')
    probe.loadSettled('failed', { failure: 'rate_limited' })
    expect(snapshot()[0].lastLoad).toMatchObject({ outcome: 'failed', failure: 'rate_limited' })
  })

  it('reports a delivery for a Folder this mount does not watch', () => {
    const probe = open()
    probe.observe(observation())
    probe.delivered(TEAM)
    // The wide filter is one REQ for every Folder in the list; a signal for
    // something else is a narrowing bug, and it would be invisible otherwise.
    expect(snapshot()[0].lastDelivery).toMatchObject({ folder: TEAM, listed: false })
  })

  it('explains the last delivered Folder when asked about none', () => {
    const probe = open()
    probe.observe(observation())
    probe.delivered(FOLDER)
    expect(snapshot().at(0)?.folder).toMatchObject({ id: FOLDER, read: true, messages: 1 })
  })

  it('separates a Folder the read never answered for from one with nothing in it', () => {
    const probe = open()
    probe.observe(
      observation({
        held: { at: NOW, streams: {} },
        result: { unread: {}, member: {} },
      }),
    )
    // `read: false` is the sentence "not judged" — the hook draws no dot, and
    // that is different from a Folder with nothing new in it.
    expect(snapshot(FOLDER)?.[0].folder).toMatchObject({
      read: false,
      messages: 0,
      streams: [],
      unread: undefined,
    })
  })

  it('says per stream whether the person is a member, and against which marker', () => {
    const probe = open()
    probe.observe(
      observation({
        termsOf: (key: string) => ({ member: key === FILE, muted: false }),
        marker: (context: string | undefined) =>
          context === channelContext(FOLDER) ? NOW - 30 : undefined,
        merged: { [channelContext(FOLDER) as string]: NOW - 30 },
        held: {
          at: NOW,
          streams: { [FOLDER]: [said('e1', NOW - 60), said('e2', NOW - 10, [FILE])] },
        },
      }),
    )
    const streams = snapshot(FOLDER)[0].folder?.streams ?? []
    expect(streams).toHaveLength(2)

    const general = streams.find((stream) => stream.key === FOLDER)
    // Not a member, so it cannot light however new it is — and the marker it
    // would have been judged against is reported anyway.
    expect(general).toMatchObject({ member: false, unread: false, messages: 1 })
    expect(general?.context).toBe(channelContext(FOLDER))
    expect(general?.marker).toBe(new Date((NOW - 30) * 1_000).toISOString())

    const file = streams.find((stream) => stream.key === FILE)
    expect(file).toMatchObject({ member: true, unread: true, marker: null })
    expect(file?.newest).toMatchObject({ mine: false })
  })

  it('marks the viewer’s own message, which never lights a dot', () => {
    const probe = open()
    probe.observe(
      observation({ held: { at: NOW, streams: { [FOLDER]: [said('e1', NOW - 10, [], ME)] } } }),
    )
    const [general] = snapshot(FOLDER)[0].folder?.streams ?? []
    expect(general).toMatchObject({ unread: false })
    expect(general?.newest).toMatchObject({ mine: true, by: ME.slice(0, 8) })
  })

  it('reports the containers a verdict folds into, and whether they are lit', () => {
    const probe = open()
    probe.observe(observation())
    // FOL-22: the dot a person sees may be on the team, not on the Folder the
    // message was in — so the row to look at is part of the answer.
    expect(snapshot(FOLDER)[0].folder?.listedIn).toEqual([{ container: TEAM, unread: true }])
  })

  it('reports the two gates that empty the map before anything is judged', () => {
    const probe = open()
    probe.observe(observation({ frontierReady: false, membership: 'unknown', result: { unread: {}, member: {} } }))
    expect(snapshot()[0]).toMatchObject({ frontierReady: false, membership: 'unknown', lit: [] })
  })

  it('lists the Folders currently lit', () => {
    const probe = open()
    probe.observe(observation())
    expect(snapshot()[0].lit).toEqual([FOLDER, TEAM])
  })
})
