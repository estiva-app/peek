/**
 * INT-9 — a launcher row is a promise, so only a declared action gets one.
 *
 * > **Miky, 2026-09-04** — *"Only create issue works, create projects in Ship
 * > doesn't work. Same create topic, create conversation in Peek doesn't
 * > work."*
 *
 * All three did the same thing: opened a form, accepted what was typed, and
 * closed on submit having published nothing. `submitAction`'s `!live` branch
 * was a bare `onClose()`, which is indistinguishable from success — and the
 * rows reaching it came from the registry, whose declarations are this
 * design's *proposal* for manifests that do not declare them yet. Ship
 * declares no `add-project`; Peek declares no actions at all.
 *
 * Nothing here asserts that the three eventually work — that needs PRO-18, and
 * a project is a Folder plus a record. What it asserts is that the launcher
 * stops claiming they do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import type { ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { CommandLauncher } from './CommandLauncher'

Element.prototype.scrollIntoView = vi.fn()

const SHIP_AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

/** Ship's live manifest declares this one, and only this one. */
const liveAddIssue: ResolvedAction = {
  id: 'add-issue',
  label: 'Add issue',
  description: 'File a new issue under a project.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'title', type: 'string', required: true }],
  createsUnder: 'self',
}

const applyAction = vi.fn(async () => ({ ok: true as const, created: `30851:${SHIP_AUTHOR}:x` }))
const creatableUnder = vi.fn(async () => ({
  actions: [liveAddIssue],
  parents: [{ address: `30850:${SHIP_AUTHOR}:p1`, title: 'Projection layer' }],
}))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    useForeignObjects: () => ({
      resolveObject: vi.fn(),
      resolveFolderProject: vi.fn(),
      applyAction,
      creatableUnder,
    }),
    useTopics: () => [],
  }
})

const onClose = vi.fn()

function open(initialAppId: string, initialActionId?: string) {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <DebugProvider>
        <PeekDataProvider>
          <CommandLauncher
            context={{}}
            onClose={onClose}
            initialAppId={initialAppId}
            initialActionId={initialActionId}
          />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  applyAction.mockClear()
  creatableUnder.mockClear()
  onClose.mockClear()
})

describe('an app is offered what it declares, and nothing else', () => {
  it('drops the registry’s Create project, and keeps Ship’s declared Add issue', async () => {
    /*
      The exact pair Miky saw side by side: one that published and one that
      did not, with nothing on screen telling them apart.
    */
    open('ship')

    expect(await screen.findByText('Add issue')).toBeInTheDocument()
    expect(screen.queryByText('Create project')).not.toBeInTheDocument()
  })

  it('offers nothing for an app that declares nothing, and says which app', async () => {
    /*
      Peek's manifest is `actions: []` on purpose — a reply names an event id
      and the action vocabulary can only name a parent address — so the honest
      list is empty. An unexplained blank reads as "this app does nothing",
      which is a different and wrong statement, so the note carries the app's
      name rather than being generic.
    */
    open('peek')

    expect(await screen.findByText(/peek has not published anything to create here yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Create a topic')).not.toBeInTheDocument()
    expect(screen.queryByText('Start a conversation')).not.toBeInTheDocument()
    // Never probed: Peek declares no parent kind, so there is nothing to read.
    expect(creatableUnder).not.toHaveBeenCalled()
  })
})

describe('a form that cannot publish says so', () => {
  it('refuses an undeclared action instead of closing as though it worked', async () => {
    /*
      Unreachable from the list now, and asserted anyway: this is the branch
      that made three dead forms look alive for a fortnight, and "unreachable"
      is a claim about one `useMemo` rather than about the app. A story, a
      proposal and the next registry entry all arrive here.

      The failure mode being locked out is specifically *silence* — `onClose`
      must not fire, because a launcher that vanishes is how a person
      concludes the thing was created.
    */
    open('peek', 'create-topic')

    await userEvent.type(await screen.findByLabelText(/title/i), 'Weekly planning')
    await userEvent.click(screen.getByRole('button', { name: 'Create topic' }))

    expect(await screen.findByText(/has not published this action/i)).toBeInTheDocument()
    expect(applyAction).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
