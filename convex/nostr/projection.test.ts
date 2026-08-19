/**
 * The Folder → project resolution behind the topic sidebar (PEEK-24).
 *
 * Written against a fake relay rather than a deployment, which is the point of
 * `projection.ts` taking a query function: this exercises the real resolution
 * path — manifest discovery, containment, folding, the active-issue rule — with
 * nothing running.
 *
 * The manifest below is shaped like Linear-lite's because that is the app in
 * the ecosystem, but nothing in the resolver may depend on it. The last test
 * asserts that directly: rename every kind and field and the sidebar still
 * fills, which is the claim the whole projection layer exists to make.
 */
import { describe, expect, it } from 'vitest'
import { resolveFolderProject } from './projection'
import type { SignedEvent } from './events'

const FOLDER = '7b32200c-e4c0-4216-b79a-8490fc05e0bd'
const AUTHOR = 'a'.repeat(64)
const PROJECT_KIND = 30850
const ISSUE_KIND = 30851
const CHANGE_KIND = 1851

let seq = 0
function event(partial: Partial<SignedEvent> & { kind: number }): SignedEvent {
  seq += 1
  return {
    id: String(seq).padStart(64, '0'),
    sig: '',
    pubkey: AUTHOR,
    created_at: 1_700_000_000 + seq,
    tags: [],
    content: '',
    ...partial,
  }
}

/** Linear-lite's manifest content, trimmed to what this resolver reads. */
function manifestContent(kinds = { project: PROJECT_KIND, issue: ISSUE_KIND, change: CHANGE_KIND }) {
  return JSON.stringify({
    name: 'Linear-lite',
    records: {
      changeKind: kinds.change,
      targetTag: 'a',
      fieldTag: 'field',
      valueTag: 'value',
      order: ['ts', 'created_at', 'id'],
      rule: 'last-write-wins-per-field',
      hiddenWhen: { field: 'archived', equals: 'true' },
    },
    projections: {
      [kinds.project]: {
        widget: 'card',
        slots: {
          title: { tag: 'title' },
          subtitle: { field: 'content', truncate: 120 },
          status: { fold: 'status', map: 'statuses', default: 'planned' },
          meta: [{ label: 'Lead', fold: 'lead', tag: 'lead', as: 'pubkey' }],
        },
      },
      [kinds.issue]: {
        widget: 'row',
        slots: {
          title: { tag: 'title' },
          status: { fold: 'status', map: 'issueStatuses', default: 'todo' },
        },
      },
    },
    vocabularies: {
      statuses: [
        { value: 'planned', label: 'Planned', colour: 'neutral' },
        { value: 'in_progress', label: 'In Progress', colour: 'blue' },
      ],
      issueStatuses: [
        { value: 'todo', label: 'Todo', colour: 'neutral' },
        { value: 'in_progress', label: 'In Progress', colour: 'blue' },
        { value: 'done', label: 'Done', colour: 'green' },
        { value: 'cancelled', label: 'Cancelled', colour: 'muted' },
      ],
    },
    actions: [
      {
        id: 'add-issue',
        label: 'Add issue',
        appliesTo: String(kinds.project),
        emits: { kind: kinds.issue, setTag: 'a', toAddressOf: 'self' },
      },
      {
        id: 'assign-project',
        label: 'Assign',
        appliesTo: String(kinds.project),
        emits: { kind: kinds.change, field: 'lead' },
        input: { type: 'pubkey' },
      },
    ],
  })
}

const manifest = (kinds = { project: PROJECT_KIND, issue: ISSUE_KIND, change: CHANGE_KIND }) =>
  event({
    kind: 31990,
    // NIP-89's `k` tags are how a handler is found for a kind, and the
    // resolver's second pass filters on them. A manifest without them is
    // discoverable by nobody.
    tags: [['d', 'app'], ['k', String(kinds.project)], ['k', String(kinds.issue)]],
    content: manifestContent(kinds),
  })

const project = (id: string, overrides: Partial<SignedEvent> = {}) =>
  event({
    kind: PROJECT_KIND,
    tags: [['d', id], ['title', 'Payment integration'], ['h', FOLDER], ['lead', 'b'.repeat(64)]],
    content: 'Stripe Checkout for workspace billing — redirect flow.',
    ...overrides,
  })

const issue = (id: string, title: string, overrides: Partial<SignedEvent> = {}) =>
  event({
    kind: ISSUE_KIND,
    tags: [['d', id], ['title', title], ['h', FOLDER], ['a', `${PROJECT_KIND}:${AUTHOR}:p1`]],
    ...overrides,
  })

const change = (target: string, field: string, value: string, overrides: Partial<SignedEvent> = {}) =>
  event({
    kind: CHANGE_KIND,
    tags: [['a', target], ['field', field], ['value', value], ['h', FOLDER]],
    ...overrides,
  })

const issueAddr = (id: string) => `${ISSUE_KIND}:${AUTHOR}:${id}`

/**
 * A relay that answers the filters this resolver actually sends. Deliberately
 * literal — a smarter fake would start hiding filter bugs.
 */
interface Filter {
  kinds?: number[]
  authors?: string[]
  limit?: number
  /** Tag filters: `#d`, `#h`, `#a`, `#k`. */
  [tag: string]: unknown
}

function relay(events: SignedEvent[]) {
  const matches = (e: SignedEvent, filter: Filter) => {
    if (filter.kinds && !filter.kinds.includes(e.kind)) return false
    if (filter.authors && !filter.authors.includes(e.pubkey)) return false
    for (const [key, values] of Object.entries(filter)) {
      if (!key.startsWith('#')) continue
      const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
      if (!held.some((v) => (values as string[]).includes(v))) return false
    }
    return true
  }
  return async (filters: Record<string, unknown>[]) =>
    events.filter((e) => filters.some((f) => matches(e, f as Filter)))
}

describe('resolveFolderProject', () => {
  it('renders the project through its manifest projection', async () => {
    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(), project('p1'), change(`${PROJECT_KIND}:${AUTHOR}:p1`, 'status', 'in_progress')]),
    )

    expect(found?.project.appName).toBe('Linear-lite')
    expect(found?.project.slots.title.value).toBe('Payment integration')
    expect(found?.project.slots.subtitle.value).toContain('Stripe Checkout')
    // Status is not on the root event at all — it only exists as a folded change.
    expect(found?.project.slots.status).toMatchObject({ value: 'In Progress', colour: 'blue' })
    // `field` names the tag or folded field behind the slot, so a renderer can
    // tell that a slot and an action are two views of one value (PEEK-18).
    expect(found?.project.meta).toEqual([
      { label: 'Lead', value: 'b'.repeat(64), colour: undefined, isPubkey: true, field: 'lead' },
    ])
  })

  it('lets a change override a field the root event seeded with a tag', async () => {
    // The project's lead is a tag on the root *and* a folded field. Reading the
    // tag first would show the original lead forever — which is exactly what
    // somebody sees right after reassigning the project from Peek.
    const found = await resolveFolderProject(
      FOLDER,
      relay([
        manifest(),
        project('p1'),
        change(`${PROJECT_KIND}:${AUTHOR}:p1`, 'lead', 'c'.repeat(64)),
      ]),
    )

    expect(found?.project.meta).toEqual([
      { label: 'Lead', value: 'c'.repeat(64), colour: undefined, isPubkey: true, field: 'lead' },
    ])
  })

  it('ignores a project its owning app has archived', async () => {
    // Archiving is a folded field, not a deletion, so an archived project comes
    // back from every query and renders perfectly well. Found in the wild: a
    // paired topic whose Folder held three archived projects showed one of them.
    const found = await resolveFolderProject(
      FOLDER,
      relay([
        manifest(),
        project('p1'),
        project('p2', { tags: [['d', 'p2'], ['title', 'Archived attempt'], ['h', FOLDER]] }),
        change(`${PROJECT_KIND}:${AUTHOR}:p2`, 'archived', 'true'),
      ]),
    )

    expect(found?.project.slots.title.value).toBe('Payment integration')
  })

  it('shows nothing when every project in the Folder is archived', async () => {
    const found = await resolveFolderProject(
      FOLDER,
      relay([
        manifest(),
        project('p1'),
        change(`${PROJECT_KIND}:${AUTHOR}:p1`, 'archived', 'true'),
      ]),
    )

    expect(found).toBeNull()
  })

  it('leaves an archived ticket out of the counts', async () => {
    const found = await resolveFolderProject(
      FOLDER,
      relay([
        manifest(),
        project('p1'),
        issue('i1', 'Live'),
        issue('i2', 'Filed then archived'),
        change(issueAddr('i2'), 'archived', 'true'),
      ]),
    )

    expect(found?.tickets.map((t) => t.slots.title.value)).toEqual(['Live'])
    expect(found?.openCount).toBe(1)
  })

  it('picks the project the Folder’s work belongs to, not the newest', async () => {
    // Pairing accumulates a project per attempt, so a Folder holding several is
    // ordinary rather than exotic. Age alone picked whichever stray was created
    // last; the tickets say which project the Folder is actually about.
    const stray = project('p9', {
      tags: [['d', 'p9'], ['title', 'Newer, and empty'], ['h', FOLDER]],
      created_at: 1_800_000_000,
    })

    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(), project('p1'), issue('i1', 'Real work'), stray]),
    )

    expect(found?.project.slots.title.value).toBe('Payment integration')
  })

  it('lists the whole project, started first, then the queue, then the done', async () => {
    const events = [
      manifest(),
      project('p1'),
      issue('i1', 'Untouched, so still Todo'),
      issue('i2', 'Retry copy'),
      issue('i3', 'Webhook signature check'),
      issue('i4', 'Billing entry'),
      change(issueAddr('i2'), 'status', 'done'),
      change(issueAddr('i3'), 'status', 'cancelled'),
      change(issueAddr('i4'), 'status', 'in_progress'),
    ]

    const found = await resolveFolderProject(FOLDER, relay(events))

    // Everything the project holds, in the order that makes it scannable:
    // what is moving, what is waiting, what is behind you.
    expect(found?.tickets.map((t) => t.slots.title.value)).toEqual([
      'Billing entry',
      'Untouched, so still Todo',
      'Webhook signature check',
      'Retry copy',
    ])
    expect(found?.tickets[0].slots.status).toMatchObject({ value: 'In Progress' })
    // The counts still divide the work; the table no longer does.
    expect(found?.openCount).toBe(2)
    expect(found?.doneCount).toBe(2)
  })

  it('lists a parked or unknown status but counts it in neither half', async () => {
    // "Backlog" is real work nobody is doing, and a status this consumer has
    // never seen is not evidence of anything. Both are still tickets, and still
    // listed — they just cannot claim to be progress in either direction.
    const events = [
      manifest(),
      project('p1'),
      issue('i1', 'Parked'),
      issue('i2', 'Something another app invented'),
      change(issueAddr('i1'), 'status', 'backlog'),
      change(issueAddr('i2'), 'status', 'percolating'),
    ]

    const found = await resolveFolderProject(FOLDER, relay(events))

    expect(found?.tickets.map((t) => t.slots.title.value)).toEqual([
      'Something another app invented',
      'Parked',
    ])
    expect(found?.openCount).toBe(0)
    expect(found?.doneCount).toBe(0)
  })

  it('follows the fold rather than the first change', async () => {
    // The seed path: an issue moved to in_progress and later closed. Reading the
    // changes in any order but the manifest's would count it as open.
    const events = [
      manifest(),
      project('p1'),
      issue('i1', 'Billing entry'),
      change(issueAddr('i1'), 'status', 'in_progress', { created_at: 1_700_000_100 }),
      change(issueAddr('i1'), 'status', 'done', { created_at: 1_700_000_200 }),
    ]

    const found = await resolveFolderProject(FOLDER, relay(events))

    expect(found?.openCount).toBe(0)
    expect(found?.doneCount).toBe(1)
    expect(found?.tickets[0].slots.status).toMatchObject({ value: 'Done' })
  })

  it('lists every ticket, however many there are', async () => {
    const events = [manifest(), project('p1')]
    for (let i = 0; i < 10; i += 1) {
      events.push(issue(`i${i}`, `Live work ${i}`))
      events.push(change(issueAddr(`i${i}`), 'status', 'in_progress'))
    }

    const found = await resolveFolderProject(FOLDER, relay(events))

    expect(found?.tickets).toHaveLength(10)
    expect(found?.openCount).toBe(10)
  })

  it('orders by when work last moved', async () => {
    const events = [
      manifest(),
      project('p1'),
      issue('old', 'Moved a while ago'),
      issue('new', 'Moved just now'),
      change(issueAddr('old'), 'status', 'in_progress', { created_at: 1_700_000_100 }),
      change(issueAddr('new'), 'status', 'in_progress', { created_at: 1_700_009_000 }),
    ]

    const found = await resolveFolderProject(FOLDER, relay(events))

    expect(found?.tickets.map((t) => t.slots.title.value)).toEqual(['Moved just now', 'Moved a while ago'])
  })

  it('keeps an issue that names no project — the Folder is the project', async () => {
    const loose = issue('i1', 'Filed without a link')
    loose.tags = loose.tags.filter((t) => t[0] !== 'a')

    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(), project('p1'), loose, change(issueAddr('i1'), 'status', 'in_progress')]),
    )

    expect(found?.tickets.map((t) => t.slots.title.value)).toEqual(['Filed without a link'])
  })

  it('drops an issue belonging to a different project in the same Folder', async () => {
    const other = issue('i1', 'Somebody else’s issue')
    other.tags = other.tags.map((t) => (t[0] === 'a' ? ['a', `${PROJECT_KIND}:${AUTHOR}:other`] : t))

    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(), project('p1'), other, change(issueAddr('i1'), 'status', 'in_progress')]),
    )

    expect(found?.tickets).toEqual([])
  })

  it('returns nothing for a Folder with no project in it', async () => {
    expect(await resolveFolderProject(FOLDER, relay([manifest()]))).toBeNull()
  })

  it('returns nothing when no app declares a container', async () => {
    const withoutContainment = event({
      kind: 31990,
      tags: [['d', 'other-app']],
      content: JSON.stringify({
        name: 'Some app',
        projections: { [PROJECT_KIND]: { widget: 'card', slots: { title: { tag: 'title' } } } },
      }),
    })

    expect(await resolveFolderProject(FOLDER, relay([withoutContainment, project('p1')]))).toBeNull()
  })

  it('works for an app Peek has never heard of', async () => {
    // Same shapes, different numbers and a different live-status spelling. If
    // any Linear-lite constant had leaked into the resolver, this returns null.
    const kinds = { project: 31500, issue: 31501, change: 1900 }
    const container = event({
      kind: kinds.project,
      tags: [['d', 'w1'], ['title', 'Field survey'], ['h', FOLDER]],
      content: 'Quarterly site visits.',
    })
    const task = event({
      kind: kinds.issue,
      tags: [['d', 't1'], ['title', 'Visit the north site'], ['h', FOLDER], ['a', `${kinds.project}:${AUTHOR}:w1`]],
    })
    const moved = event({
      kind: kinds.change,
      tags: [
        ['a', `${kinds.issue}:${AUTHOR}:t1`],
        ['field', 'status'],
        ['value', 'started'],
        ['h', FOLDER],
      ],
    })

    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(kinds), container, task, moved]),
    )

    expect(found?.project.slots.title.value).toBe('Field survey')
    expect(found?.tickets.map((t) => t.slots.title.value)).toEqual(['Visit the north site'])
  })
})

/**
 * Who the people on another app's objects actually are (FEE-1).
 *
 * A manifest says a slot holds a pubkey; it never says whose. The name and face
 * come from kind:0 — the same place the message list gets them — and are
 * resolved *with* the object rather than after it, so a renderer never has a
 * key on screen while it waits for a lookup.
 */
describe('resolveFolderProject — people', () => {
  const LEAD = 'b'.repeat(64)

  const profile = (pubkey: string, fields: Record<string, string>) =>
    event({ kind: 0, pubkey, content: JSON.stringify(fields) })

  it('names the lead from their kind:0', async () => {
    const found = await resolveFolderProject(
      FOLDER,
      relay([
        manifest(),
        project('p1'),
        profile(LEAD, { display_name: 'Jan Miky', picture: 'https://example.com/j.png' }),
      ]),
    )

    expect(found?.project.people?.[LEAD]).toEqual({
      displayName: 'Jan Miky',
      picture: 'https://example.com/j.png',
    })
  })

  it('reads `name` as well as `display_name`, because both are published', async () => {
    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(), project('p1'), profile(LEAD, { name: 'Jan Miky' })]),
    )

    expect(found?.project.people?.[LEAD]?.displayName).toBe('Jan Miky')
  })

  it('leaves someone unknown rather than inventing a name for them', async () => {
    // Nobody published a profile. The object still resolves — a missing name
    // costs a name, never the panel.
    const found = await resolveFolderProject(FOLDER, relay([manifest(), project('p1')]))

    expect(found?.project.slots.title.value).toBe('Payment integration')
    expect(found?.project.people?.[LEAD]?.displayName).toBeUndefined()
  })

  it('asks about the lead even though only an action holds them', async () => {
    /*
     * The sidebar renders the lead *inside* the assign control, so `current` is
     * the only place that pubkey appears once a viewer can act. Collecting
     * pubkeys from slots alone would leave exactly the control FEE-1 was filed
     * about still showing a key.
     */
    const asked: string[][] = []
    await resolveFolderProject(FOLDER, relay([manifest(), project('p1')]), async (pubkeys) => {
      asked.push(pubkeys)
      return {}
    })

    expect(asked.flat()).toContain(LEAD)
  })

  it('shares one lookup across the project and its tickets', async () => {
    // One round trip, not one per object — and every object carries the answer,
    // so a renderer that starts naming assignees needs no second trip.
    const calls: string[][] = []
    const found = await resolveFolderProject(
      FOLDER,
      relay([manifest(), project('p1'), issue('t1', 'Billing entry')]),
      async (pubkeys) => {
        calls.push(pubkeys)
        return { [LEAD]: { displayName: 'Jan Miky' } }
      },
    )

    expect(calls).toHaveLength(1)
    expect(found?.tickets[0].people?.[LEAD]?.displayName).toBe('Jan Miky')
  })
})
