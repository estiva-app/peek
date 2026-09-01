/**
 * Acting on an object whose Folder is not spelled `h`.
 *
 * Reported from a screenshot: creating an issue under "Peek's Intelligence"
 * failed with *"That object has no Folder, so there is nowhere to write."*
 *
 * The record has a Folder. It is published **globally** — belonging to no
 * Folder itself while still naming one — so it carries `buzz-channel` rather
 * than NIP-29's `h`. Ship's projects moved to that shape in REW-11 and Ship's
 * own fold has read both ever since; this path read only `h`.
 *
 * Measured on production at the time: **5 of 15 projects had no `h` tag — the
 * five newest**, which are exactly the ones somebody reaches for. Every action
 * on them failed from here, not only creation.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
  `vi.hoisted`, because `vi.mock` is lifted above every declaration in the file:
  a factory closing over plain consts throws "Cannot access before
  initialization" — loudly, which is the one mercy of it.
*/
const { queryRelay, publishSigned, signViaEstivaId } = vi.hoisted(() => ({
  queryRelay: vi.fn(),
  publishSigned: vi.fn(async () => ({ ok: true as const })),
  signViaEstivaId: vi.fn(async (event: unknown) => event),
}))

vi.mock('./bridge', () => ({ queryRelay, publishSigned, signViaEstivaId }))

import { applyActionAsViewer } from './foreign'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const FOLDER = '9c69f247-0000-4000-8000-000000000000'
const PROJECT = 30850
const ISSUE = 30851
const ADDRESS = `${PROJECT}:${AUTHOR}:p1`
const token = { accessToken: 't', pubkey: AUTHOR } as never

/*
  Typed, not spread from a `Record<string, unknown>`: that widens nothing, so
  `e.kind` is not a known property and `tsc -b` refuses it — while `vitest`
  passes, because it strips types rather than checking them. Second time I have
  written this helper the wrong way; the build is what says so.
*/
interface TestEvent {
  id: string
  sig: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

let seq = 0
const event = (partial: Partial<TestEvent> & { kind: number }): TestEvent => ({
  id: String(++seq).padStart(64, '0'),
  sig: '',
  pubkey: AUTHOR,
  created_at: 1_700_000_000 + seq,
  tags: [],
  content: '',
  ...partial,
})

const manifest = event({
  kind: 31990,
  tags: [['d', 'estiva-ship'], ['k', String(PROJECT)]],
  content: JSON.stringify({
    name: 'Estiva Ship',
    records: { changeKind: 1851, targetTag: 'a', fieldTag: 'field', valueTag: 'value' },
    projections: { [PROJECT]: { widget: 'card', slots: { title: { tag: 'name' } } } },
    actions: [
      {
        id: 'add-issue',
        label: 'Add issue',
        appliesTo: String(PROJECT),
        emits: { kind: ISSUE, setTag: 'a', toAddressOf: 'self' },
        input: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      },
    ],
  }),
})

/** A relay answering from `world`, honouring kinds/authors/#-tags. */
function relayOver(world: ReturnType<typeof event>[]) {
  return vi.fn(async (_url: string, filters: Record<string, unknown>[]) => ({
    ok: true as const,
    events: world.filter((e) =>
      filters.some((f) => {
        if (f.kinds && !(f.kinds as number[]).includes(e.kind)) return false
        if (f.authors && !(f.authors as string[]).includes(e.pubkey)) return false
        for (const [key, want] of Object.entries(f)) {
          if (!key.startsWith('#')) continue
          const held = e.tags.filter((t) => t[0] === key.slice(1)).map((t) => t[1])
          if (!(want as string[]).some((v) => held.includes(v))) return false
        }
        return true
      }),
    ),
  }))
}

beforeEach(() => {
  publishSigned.mockClear()
  signViaEstivaId.mockClear()
})

const create = () =>
  applyActionAsViewer(
    { naddr: ADDRESS, actionId: 'add-issue', value: { title: 'Testing issue directly from Peek' } },
    'https://relay.test',
    token,
  )

describe('the Folder is found however the record spells it', () => {
  it('acts on a global record, which names its Folder as buzz-channel', async () => {
    const project = event({ kind: PROJECT, tags: [['d', 'p1'], ['name', "Peek's Intelligence"], ['buzz-channel', FOLDER]] })
    queryRelay.mockImplementation(relayOver([manifest, project]))

    const result = await create()

    expect(result.ok).toBe(true)
    const published = signViaEstivaId.mock.calls[0][0] as { tags: string[][] }
    expect(published.tags).toContainEqual(['h', FOLDER])
  })

  it('still acts on a record that carries h, which most do', async () => {
    const project = event({ kind: PROJECT, tags: [['d', 'p1'], ['name', 'Older project'], ['h', FOLDER]] })
    queryRelay.mockImplementation(relayOver([manifest, project]))

    const result = await create()

    expect(result.ok).toBe(true)
    const published = signViaEstivaId.mock.calls[0][0] as { tags: string[][] }
    expect(published.tags).toContainEqual(['h', FOLDER])
  })

  it('still refuses a record that names no Folder at all', async () => {
    // The message was right, it was simply being reached for the wrong reason.
    const project = event({ kind: PROJECT, tags: [['d', 'p1'], ['name', 'Homeless']] })
    queryRelay.mockImplementation(relayOver([manifest, project]))

    const result = await create()

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/no Folder/)
    expect(publishSigned).not.toHaveBeenCalled()
  })
})
