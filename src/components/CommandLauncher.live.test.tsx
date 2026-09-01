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
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
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
const applyAction = vi.fn(async (_args: ApplyArgs) => ({ ok: true as const, created: '30851:me:new' }))
const creatableUnder = vi.fn(async () => ({
  actions: [liveAddIssue],
  parents: [
    { address: PROJECT_A, title: 'Projection layer' },
    { address: PROJECT_B, title: 'Cross-app read state' },
  ],
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

function open() {
  render(
    <DebugProvider>
      <PeekDataProvider>
        <CommandLauncher context={{}} onClose={vi.fn()} initialAppId="ship" />
      </PeekDataProvider>
    </DebugProvider>,
  )
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
    await userEvent.click(await screen.findByText('Add issue'))
    await userEvent.type(screen.getByRole('textbox'), 'Billing entry')
    await userEvent.click(screen.getByLabelText('Project'))
    await userEvent.click(await screen.findByText('Projection layer'))
    // Exact, because the chip that leaves the form is also "…Add issue".
    await userEvent.click(screen.getByRole('button', { name: 'Add issue' }))

    expect(applyAction).toHaveBeenCalledTimes(1)
    const call = applyAction.mock.calls[0][0]
    expect(call.actionId).toBe('add-issue')
    // The parent travels as the object being acted on, never as a property —
    // the runtime refuses any key the manifest did not declare.
    expect(call.value).toEqual({ title: 'Billing entry' })
    expect(call.naddr.startsWith('naddr')).toBe(true)
  })
})
