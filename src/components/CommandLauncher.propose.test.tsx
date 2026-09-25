/**
 * INT-5 — the conversation suggests what to make of it, over whatever any app
 * declares.
 *
 * **Every fixture here is an app nobody wrote.** That is not decoration: the
 * ticket's done-when is RFC 0.4 §15's test — an app nobody here wrote
 * publishes a manifest and this works for it the same day — and the only way to
 * assert it is to run the whole flow against an app that does not exist. If a
 * later change makes this file need Ship, or an issue, the change is the bug.
 *
 * Two safety properties carry the ticket, and both are negative:
 *
 * 1. **The model proposes; it never invokes.** `applyAction` is mocked and must
 *    not be called by anything on this path.
 * 2. **Only a real declared action comes out.** Structured output is refused on
 *    some builds, so the answer arrives through the lenient path — an id
 *    nothing declared is dropped rather than guessed at.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { enter } from '@/test-enter'
import { MemoryRouter } from 'react-router-dom'
import type { ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import type { ModelAvailability } from '@/lib/promptApi'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import { CommandLauncher } from './CommandLauncher'

const AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'

/** An app nobody here wrote, declaring an action nobody here declared. */
const logSighting: ResolvedAction = {
  id: 'log-sighting',
  label: 'Log a sighting',
  description: 'Record that a bird was seen, with the species and where it was.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'species', type: 'string', required: true }],
  createsUnder: 'self',
}

const cullFlock: ResolvedAction = {
  ...logSighting,
  id: 'cull-flock',
  label: 'Cull the flock',
  description: 'Permanently remove every record for a colony.',
  effect: 'destructive',
}

const { canPrefill, prefillAvailability, promptForObject, applyAction, creatableUnder } = vi.hoisted(() => ({
  canPrefill: vi.fn(async () => true),
  // Gates the row since INT-10; see promptApi's `downloadModel`.
  prefillAvailability: vi.fn<() => Promise<ModelAvailability>>(async () => 'available'),
  promptForObject: vi.fn<(instruction: string, schema: object) => Promise<Record<string, unknown> | null>>(),
  /*
    Typed with its argument, not `async () => …`. A zero-parameter mock gives
    `mock.calls` the tuple type `[]`, so reading `calls[0][0]` is an error
    `vitest` never sees and `tsc -b` does — the same trap `CommandLauncher.
    live.test.tsx` documents. It only surfaced here once something asserted on
    what was published rather than that nothing was.
  */
  applyAction: vi.fn(
    async (_args: { naddr: string; actionId: string; value: string | Record<string, string> }) => ({
      ok: true as const,
      created: `30851:${AUTHOR}:x`,
    }),
  ),
  creatableUnder: vi.fn<
    (kind: number) => Promise<{ actions: ResolvedAction[]; parents: { address: string; title: string }[] } | null>
  >(),
}))
vi.mock('@/lib/promptApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/promptApi')>('@/lib/promptApi')
  return { ...actual, canPrefill, prefillAvailability, promptForObject }
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
    useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }),
  }
})

Element.prototype.scrollIntoView = vi.fn()

const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false },
  conversation: {
    references: [],
    messages: [{ id: 'r1', author: 'Amie', timestamp: '9:02 AM', body: 'saw a kingfisher by the weir this morning' }],
  },
}

const onClose = vi.fn()

function open(context: LauncherContext = inThread) {
  render(
    <MemoryRouter initialEntries={['/topics/1']}>
      <DebugProvider>
        <PeekDataProvider>

        <LastSelectionProvider>

        <ToastProvider>
          <CommandLauncher context={context} onClose={onClose} />
        </ToastProvider>

        </LastSelectionProvider>

        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

const input = () => document.querySelector<HTMLInputElement>('[data-command-palette-field]')!
const makeRow = () => screen.findByText(/Suggest what to make from this conversation/i)

async function propose(typed = 'kingfisher') {
  open()
  await enter(input(),typed)
  await userEvent.click(await makeRow())
}

beforeEach(() => {
  canPrefill.mockResolvedValue(true)
  prefillAvailability.mockResolvedValue('available')
  promptForObject.mockResolvedValue({ action: 'log-sighting', preview: 'A kingfisher seen at the weir' })
  creatableUnder.mockResolvedValue({
    actions: [logSighting],
    parents: [{ address: `39701:${AUTHOR}:colony`, title: 'Weir colony' }],
  })
  applyAction.mockClear()
  promptForObject.mockClear()
  creatableUnder.mockClear()
  onClose.mockClear()
})

describe('the row', () => {
  it('is offered once something is typed, beside the others', async () => {
    open()
    await enter(input(),'kingfisher')

    expect(await makeRow()).toBeInTheDocument()
    expect(screen.getByText(/^Ask: “/)).toBeInTheDocument()
  })

  it('is absent with no conversation to make anything of', async () => {
    open({ composer: { isFocused: true, hasDraft: false } })
    await enter(input(),'kingfisher')

    expect(screen.queryByText(/Suggest what to make from this conversation/i)).not.toBeInTheDocument()
  })

  it('is absent where no model could choose', async () => {
    canPrefill.mockResolvedValue(false)
    prefillAvailability.mockResolvedValue('downloadable')
    open()
    await enter(input(),'kingfisher')

    expect(screen.queryByText(/Suggest what to make from this conversation/i)).not.toBeInTheDocument()
  })

  it('reads no manifest until something is typed or it is taken', async () => {
    // A relay read per app on every Cmd+K would be a second and a half nobody
    // asked for. Discovery is lazy: opening reads nothing. Typing does, since
    // an action can be found by its name there (C4, UIG-29).
    open()
    await makeRow()
    expect(creatableUnder).not.toHaveBeenCalled()

    await userEvent.click(await makeRow())
    await waitFor(() => expect(creatableUnder).toHaveBeenCalled())
  })
})

describe('the proposal is chosen from what apps declare', () => {
  it('asks every app that says what to query', async () => {
    // Which apps, and which kind each one needs, comes off the registry — the
    // component names no app and no number.
    await propose()
    await screen.findByTestId('proposal')

    expect(creatableUnder).toHaveBeenCalled()
    for (const [kind] of creatableUnder.mock.calls) expect(typeof kind).toBe('number')
  })

  it('offers the declared description as the matching material', async () => {
    await propose()
    await screen.findByTestId('proposal')

    const [instruction] = promptForObject.mock.calls[0]
    expect(instruction).toContain('Record that a bird was seen')
    expect(instruction).toContain('saw a kingfisher by the weir this morning')
  })

  it('shows which app it is about to write to', async () => {
    // A label alone means nothing across apps: two may declare something
    // plausibly matching.
    await propose()

    expect(await screen.findByTestId('proposal')).toHaveTextContent('A kingfisher seen at the weir')
    // On the card, and again on the row that opens its form: which app, and which action.
    expect(screen.getAllByText(/Ship › Log a sighting/).length).toBeGreaterThan(0)
  })

  it('says it is working rather than showing an empty panel', async () => {
    let release: (v: { actions: ResolvedAction[]; parents: { address: string; title: string }[] }) => void = () => {}
    creatableUnder.mockReturnValue(new Promise((resolve) => (release = resolve)))
    await propose()

    expect(await screen.findByText(/Reading the conversation/i)).toBeInTheDocument()
    release({ actions: [logSighting], parents: [] })
    expect(await screen.findByTestId('proposal')).toBeInTheDocument()
  })

  it('never offers a destructive action', async () => {
    /*
      A judgement rather than an RFC rule: nothing here invokes anything, so
      `writes` is already safe by construction — but a model reading a thread
      and offering to delete a colony is a footgun a form does not defuse.
    */
    creatableUnder.mockResolvedValue({ actions: [cullFlock], parents: [] })
    await propose()

    expect(await screen.findByText(/Nothing here matches/i)).toBeInTheDocument()
    expect(promptForObject).not.toHaveBeenCalled()
  })

  it('says so when the model names an action nothing declared', async () => {
    // The lenient path can return anything at all.
    promptForObject.mockResolvedValue({ action: 'delete-everything', preview: 'go on' })
    await propose()

    expect(await screen.findByText(/Nothing here matches/i)).toBeInTheDocument()
  })

  it('says so when the model declines', async () => {
    promptForObject.mockResolvedValue({ action: 'none', preview: 'nothing fits' })
    await propose()

    expect(await screen.findByText(/Nothing here matches/i)).toBeInTheDocument()
  })

  it('says so when no app is readable', async () => {
    creatableUnder.mockResolvedValue(null)
    await propose()

    expect(await screen.findByText(/Nothing here matches/i)).toBeInTheDocument()
    expect(promptForObject).not.toHaveBeenCalled()
  })

  it('survives an app whose manifest read fails', async () => {
    // A read that fails must produce a sentence, not silence — and must not
    // take the other apps down with it.
    creatableUnder.mockRejectedValue(new Error('relay_membership_required'))
    await propose()

    expect(await screen.findByText(/Nothing here matches/i)).toBeInTheDocument()
  })
})

describe('the model proposes; a person creates', () => {
  it('opens the action’s own form', async () => {
    await propose()
    await screen.findByTestId('proposal')

    await userEvent.click(screen.getByRole('option', { name: /Open the form/i }))
    // The field the manifest declared, drawn by the panel that draws any of
    // them — nothing here knows what a species is.
    expect(await screen.findByLabelText(/species/i)).toBeInTheDocument()
  })

  it('publishes nothing on its own', async () => {
    /*
      The ticket's hard boundary, asserted where it would break: taking a
      proposal must reach the form and stop. PEE-5's "nothing submits without a
      person", generalised.
    */
    await propose()
    await screen.findByTestId('proposal')
    await userEvent.click(screen.getByRole('option', { name: /Open the form/i }))
    await screen.findByLabelText(/species/i)

    expect(applyAction).not.toHaveBeenCalled()
  })

  it('brings the parent list the form needs', async () => {
    /*
      A proposal opens the form without scoping into the app, and a parent field
      with no options is a form the runtime refuses — which closes silently and
      looks like success (PEE-1).
    */
    await propose()
    await screen.findByTestId('proposal')
    await userEvent.click(screen.getByRole('option', { name: /Open the form/i }))

    // The picker's own noun, whatever the app called it — the first app
    // declaring it is Ship, whose word is Project, not Parent (R10) — and the
    // real record behind it, not the registry's mock list.
    await userEvent.click(await screen.findByLabelText(/project/i))
    expect(await screen.findByText('Weir colony')).toBeInTheDocument()
  })

  it('leaves without proposing anything', async () => {
    await propose()
    await screen.findByTestId('proposal')

    await userEvent.click(screen.getByRole('button', { name: /Leave Make/i }))
    expect(applyAction).not.toHaveBeenCalled()
    expect(screen.queryByTestId('proposal')).not.toBeInTheDocument()
  })

  it('publishes when the person submits it', async () => {
    /*
      **The half this file never reached, and it did not work** (INT-9).

      Every test above is negative — `applyAction` must NOT be called — and all
      of them passed against a form that could not publish at all. `submitAction`
      gated on `liveShip`, which is set only by scoping into an app; a proposal
      opens the form with no scope, so the gate was `undefined` and every submit
      took the silent `onClose()`. Make reached the form and stopped there
      permanently.

      A suite of negative assertions cannot tell "correctly does nothing yet"
      from "does nothing ever". This is the positive one.
    */
    await propose()
    await screen.findByTestId('proposal')
    await userEvent.click(screen.getByRole('option', { name: /Open the form/i }))

    await userEvent.type(await screen.findByLabelText(/species/i), 'Kingfisher')
    await userEvent.click(screen.getByLabelText(/project/i))
    // By role: text also finds the option in the list before it has opened
    // (see `createIssue` in CommandLauncher.live.test.tsx).
    await userEvent.click(await screen.findByRole('option', { name: 'Weir colony' }))
    await userEvent.click(screen.getByRole('button', { name: 'Log a sighting' }))

    expect(applyAction).toHaveBeenCalledTimes(1)
    const call = applyAction.mock.calls[0][0]
    expect(call.actionId).toBe('log-sighting')
    expect(call.value).toEqual({ species: 'Kingfisher' })
    // Addressed to the parent that was picked, never named — the runtime
    // resolves the manifest from the object being acted on.
    expect(call.naddr.startsWith('naddr')).toBe(true)
  })
})
