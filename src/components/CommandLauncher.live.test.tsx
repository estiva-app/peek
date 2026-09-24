/**
 * PRO-4 — the launcher must draw Ship's form from Ship's *manifest*.
 *
 * This is the test that was missing, and its absence is exactly why the bug
 * shipped. `liveAction.test.ts` proved the conversion and
 * `ActionFormPanel.live.test.tsx` proved the panel renders a converted action
 * — both true, both passing, while the launcher went on rendering the mock:
 * the rows came from the registry, so the form showed three invented projects
 * and an assignee Ship does not declare, and submit matched the id, found no
 * `__parent`, and closed without publishing. It looked like it worked.
 *
 * So this drives the launcher itself, from the outside, and asserts on what a
 * person sees.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import type { ResolvedAction } from '@estiva-app/interop'
import { addrToNaddr } from '@estiva-app/protocol'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

/*
  jsdom has no scrollIntoView, and the launcher keeps the highlighted row in
  view. Stubbed rather than avoided: the keyboard behaviour is real and worth
  keeping — it simply has nowhere to scroll here.
*/
Element.prototype.scrollIntoView = vi.fn()

/*
  A real 64-hex author, not a short stand-in. `addrToNaddr` refuses anything
  else — NIP-19 needs 32 bytes — and the first version of this test used
  `aaaa`, so the encode threw, `void submitAction(…)` swallowed it, and the
  spy simply never fired. A fixture the encoder would reject proves nothing
  about a path that encodes.
*/
const SHIP_AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const PROJECT_A = `30850:${SHIP_AUTHOR}:p1`
const PROJECT_B = `30850:${SHIP_AUTHOR}:p2`

/** Exactly what `creatableUnderAsViewer` returns for Ship's live manifest. */
const liveAddIssue: ResolvedAction = {
  id: 'add-issue',
  label: 'Add issue',
  description: 'File a new issue under a project.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'title', type: 'string', required: true }],
  createsUnder: 'self',
}

/*
  Typed with its argument, not `async () => …`: a zero-parameter mock gives
  `mock.calls` the tuple type `[]`, so reading `calls[0][0]` is a type error —
  which `vitest` never sees, because it strips types rather than checking them.
  `npm run build` does.
*/
type ApplyArgs = { naddr: string; actionId: string; value: string | Record<string, string> }
/*
  `created` has to be an address the encoder will accept, for the same reason
  SHIP_AUTHOR does: `addrToNaddr` needs 32 bytes, and the reference insert
  (PEE-2) runs it. The old fixture here was `30851:me:new` — inert while
  nothing encoded it, and a throw swallowed by `void submitAction(…)` the
  moment something did.
*/
const CREATED = `30851:${SHIP_AUTHOR}:0f68a3f3-e44e-46c8-82dd-76432b358a18`
const applyAction = vi.fn(async (_args: ApplyArgs) => ({ ok: true as const, created: CREATED }))
const creatableUnder = vi.fn(async () => ({
  actions: [liveAddIssue],
  parents: [
    { address: PROJECT_A, title: 'Projection layer' },
    { address: PROJECT_B, title: 'Cross-app read state' },
  ],
}))

/*
  The insert itself is covered against the real `findNaddrs`/`stripNaddrs` in
  `lib/composerRegistry.test.ts`. What this file is for is what the launcher
  passes it, and whether it acts on the answer.
*/
/*
  `vi.hoisted`, because `vi.mock` is hoisted above every top-level `const` and
  `CommandLauncher` imports the registry at module scope — a plain const is
  still uninitialised when the factory runs. The `@/api` mock above gets away
  with a plain one only because its reference sits inside an arrow the renderer
  calls later.
*/
const { insertReference } = vi.hoisted(() => ({ insertReference: vi.fn(() => true) }))
vi.mock('@/lib/composerRegistry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/composerRegistry')>('@/lib/composerRegistry')
  return { ...actual, insertReferenceIntoActiveComposer: insertReference }
})

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
  }
})

function open(context: LauncherContext = {}, onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <DebugProvider>
        <PeekDataProvider>

        <LastSelectionProvider>

        <ToastProvider>
          <CommandLauncher context={context} onClose={onClose} initialAppId="ship" />
        </ToastProvider>

        </LastSelectionProvider>

        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  return { onClose }
}

/** Fill in Ship's `add-issue` form and submit it. */
async function createIssue(title = 'Billing entry') {
  await userEvent.click(await screen.findByText('Add issue'))
  await userEvent.type(screen.getByRole('textbox'), title)
  await userEvent.click(screen.getByLabelText('Project'))
  /*
    By role, not by text. Focusing the trigger puts Base UI's list in the page
    at once, but a mouse press opens it one animation frame later; until then
    the list is `hidden` and `pointer-events: none`. A text query finds the
    option inside that closed list, and when the click lands before the frame
    user-event refuses it — the "pointer-events: none" flake. A role query
    skips hidden elements, so it waits for the list to be open.
  */
  await userEvent.click(await screen.findByRole('option', { name: 'Projection layer' }))
  // Exact, because the chip that leaves the form is also "…Add issue".
  await userEvent.click(screen.getByRole('button', { name: 'Add issue' }))
}

describe('the launcher draws Ship’s form from Ship’s manifest (PRO-4)', () => {
  it('offers the projects that exist, not the registry’s invented ones', async () => {
    open()
    await userEvent.click(await screen.findByText('Add issue'))
    await userEvent.click(await screen.findByLabelText('Project'))

    expect(await screen.findByText('Projection layer')).toBeInTheDocument()
    expect(screen.getByText('Cross-app read state')).toBeInTheDocument()

    // The three that were on screen when this was reported.
    expect(screen.queryByText('Dashboard redesign')).not.toBeInTheDocument()
    expect(screen.queryByText('Mobile onboarding')).not.toBeInTheDocument()
    expect(screen.queryByText('Files & sharing')).not.toBeInTheDocument()
  })

  it('draws only the fields Ship declares', async () => {
    // Ship's `add-issue` declares exactly `{ title }`. Status and assignee are
    // the registry's proposal for what the manifest should grow, and drawing
    // them offers a person control over something that will not be published.
    open()
    await userEvent.click(await screen.findByText('Add issue'))

    expect(await screen.findByText('Title')).toBeInTheDocument()
    expect(screen.getByLabelText('Project')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/search people/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
  })

  it('publishes what the form collected, with the parent split back out', async () => {
    open()
    await createIssue()

    expect(applyAction).toHaveBeenCalledTimes(1)
    const call = applyAction.mock.calls[0][0]
    expect(call.actionId).toBe('add-issue')
    // The parent travels as the object being acted on, never as a property —
    // the runtime refuses any key the manifest did not declare.
    expect(call.value).toEqual({ title: 'Billing entry' })
    expect(call.naddr.startsWith('naddr')).toBe(true)
  })
})

describe('while the manifest is still being read (the 1.5 s window)', () => {
  it('offers no Ship action rather than the registry’s, and says why', async () => {
    /*
      Measured against production: listing the projects takes ~510 ms and
      resolving one for its manifest ~940 ms, so for about a second and a half
      the registry's declaration is the only one to hand. Offering it means
      offering a form whose parent field the runtime refuses — which closes
      silently and looks like success, the exact failure this whole ticket kept
      producing. The launcher's own rule is to list only what can succeed.
    */
    let release!: (v: Awaited<ReturnType<typeof creatableUnder>>) => void
    creatableUnder.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    open()

    expect(await screen.findByText(/reading ship’s manifest/i)).toBeInTheDocument()
    expect(screen.queryByText('Create issue')).not.toBeInTheDocument()
    expect(screen.queryByText('Create project')).not.toBeInTheDocument()

    release({ actions: [liveAddIssue], parents: [{ address: PROJECT_A, title: 'Projection layer' }] })
    expect(await screen.findByText('Add issue')).toBeInTheDocument()
  })

  it('says so when the read fails, instead of falling back to a mock', async () => {
    // A failure used to be silence: the effect had no catch, so a refused read
    // left the registry on screen looking authoritative.
    creatableUnder.mockRejectedValueOnce(new Error('relay_membership_required'))
    open()

    expect(await screen.findByText(/could not read ship’s manifest/i)).toBeInTheDocument()
    expect(screen.queryByText('Create issue')).not.toBeInTheDocument()
  })
})

describe('the created object leaves a trace in the thread (PEE-2)', () => {
  /*
    > Katerina, 2026-08-19 — *"Now I have no clue this whole conversation has an
    > issue assigned, as I have to open the thread first."*

    Creating the issue elsewhere solves the typing and not the knowing. A
    version that files it and says nothing in the thread is the context switch
    with an extra step.
  */
  beforeEach(() => {
    insertReference.mockClear()
    insertReference.mockReturnValue(true)
    applyAction.mockClear()
  })

  it('puts the new object’s reference in the composer, and closes', async () => {
    const { onClose } = open({ composer: { isFocused: true, hasDraft: false, label: 'Reply to Katerina' } })
    await createIssue()

    // The address off the runtime, encoded — not recomposed from the form.
    expect(insertReference).toHaveBeenCalledWith(addrToNaddr(CREATED, []))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without a reference when a change was made rather than an object created', async () => {
    // Only a creation returns an address. A change is a statement about an
    // object that already had one, so there is nothing new to point at.
    applyAction.mockResolvedValueOnce({ ok: true as const } as never)
    const { onClose } = open({ composer: { isFocused: true, hasDraft: false } })
    await createIssue()

    expect(insertReference).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('closes quietly when no conversation is open', async () => {
    /*
      The launcher is global, so creating an object with nothing open is a
      normal thing to do — there is nowhere to leave a reference and that is
      not a failure. The object exists either way.
    */
    insertReference.mockReturnValue(false)
    const { onClose } = open()
    await createIssue()

    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByText(/could not be placed/i)).not.toBeInTheDocument()
  })

  it('says the trace went missing when a conversation WAS open', async () => {
    /*
      The distinction the captured context buys. Same `false` from the registry,
      opposite meaning: a conversation surface was open at the invoking
      keystroke, so the reference should have landed somewhere and did not.
      Silence here is the object created and the thread none the wiser, which is
      the whole defect this ticket exists for.
    */
    insertReference.mockReturnValue(false)
    const { onClose } = open({ composer: { isFocused: true, hasDraft: false } })
    await createIssue()

    expect(await screen.findByText(/could not be placed/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not report a create as failed when only the encode broke', async () => {
    // The object was created. Saying "failed" would be a lie about the half
    // that worked, so the message names the half that did not.
    applyAction.mockResolvedValueOnce({ ok: true as const, created: 'not-an-address' } as never)
    const { onClose } = open({ composer: { isFocused: true, hasDraft: false } })
    await createIssue()

    expect(await screen.findByText(/^Created, but/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
