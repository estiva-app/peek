/**
 * PEE-3 — changing an existing object from the conversation, driven end to end.
 *
 * > **Katerina, 2026-08-19** — *"it would also be useful to assign existing
 * > issue, not just create new one"*
 *
 * The done-when is *"changing an issue's status or assignee from a Peek
 * conversation publishes a real change event … and the target was chosen
 * without leaving the thread"*. The publish is `applyAction`, asserted here on
 * its arguments; the relay half is the runtime's, already covered by
 * `applyAction.test.ts`.
 *
 * The shape that matters: a change sends a **scalar** to an existing object,
 * where a creation sends a property bag under a parent. `applyActionAsViewer`
 * branches on exactly that, so getting it wrong here would publish a creation's
 * shape at a change's action id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import type { LauncherContext } from '@/lib/launcherContext'
import { CommandLauncher } from './CommandLauncher'

const SHIP_AUTHOR = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const ISSUE_ADDR = `30851:${SHIP_AUTHOR}:0f68a3f3-e44e-46c8-82dd-76432b358a18`
const ISSUE_NADDR = 'naddr1resolvedissue'

/** What `resolveObject` hands back for the issue the thread refers to. */
const ISSUE = {
  ref: ISSUE_ADDR,
  address: ISSUE_ADDR,
  naddr: ISSUE_NADDR,
  eventId: 'e'.repeat(64),
  kind: 30851,
  widget: 'card',
  appName: 'Ship',
  slots: { title: { value: 'Billing entry' } },
  meta: [],
  comments: [],
  viaRecommendation: true,
  actions: [
    {
      id: 'set-issue-status',
      label: 'Set status',
      control: 'select' as const,
      field: 'status',
      current: 'todo',
      options: [
        { value: 'todo', label: 'Todo' },
        { value: 'done', label: 'Done' },
      ],
    },
  ],
} as unknown as ForeignObject

/*
  Typed with `vi.fn<T>` rather than an inferred `(_args) => …`: the tuple type
  is what makes `mock.calls[0][0]` readable, and the inferred form needs an
  unused binding to get it — which `CommandLauncher.live.test.tsx` has and lint
  flags. Same guarantee, no unused parameter.
*/
type ApplyArgs = { naddr: string; actionId: string; value: unknown }
const { applyAction, resolveObject, creatableUnder } = vi.hoisted(() => ({
  applyAction: vi.fn<(args: { naddr: string; actionId: string; value: unknown }) => Promise<{ ok: boolean; reason?: string }>>(
    async () => ({ ok: true }),
  ),
  resolveObject: vi.fn(),
  creatableUnder: vi.fn(async () => null),
}))

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    useForeignObjects: () => ({
      resolveObject,
      resolveFolderProject: vi.fn(),
      applyAction,
      creatableUnder,
    }),
    useMessageSearch: () => ({ state: { kind: 'idle' as const }, hits: [] }),
  }
})

Element.prototype.scrollIntoView = vi.fn()

/** A launcher invoked from a thread that already refers to the issue. */
const inThread: LauncherContext = {
  composer: { isFocused: true, hasDraft: false },
  conversation: { references: [ISSUE_ADDR] },
}

function open(context: LauncherContext = inThread, onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/topics/1']}>
      <DebugProvider>
        <PeekDataProvider>
          <CommandLauncher context={context} onClose={onClose} />
        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
  return { onClose }
}

describe('changing an object the conversation already refers to (PEE-3)', () => {
  beforeEach(() => {
    applyAction.mockClear()
    resolveObject.mockReset()
    resolveObject.mockResolvedValue(ISSUE)
  })

  it('offers the object’s declared actions, named by the object', async () => {
    open()
    expect(await screen.findByText('In this conversation')).toBeInTheDocument()
    expect(screen.getByText('Set status')).toBeInTheDocument()
    // The row says WHICH object, because a launcher that publishes to a shared
    // record must never leave the target implicit.
    expect(screen.getByText('Billing entry')).toBeInTheDocument()
  })

  it('publishes a scalar to the target, not a property bag', async () => {
    open()
    await userEvent.click(await screen.findByText('Set status'))
    await userEvent.click(await screen.findByRole('button', { name: 'Set status' }))

    expect(applyAction).toHaveBeenCalledTimes(1)
    const call: ApplyArgs = applyAction.mock.calls[0][0]
    expect(call.actionId).toBe('set-issue-status')
    // Addressed by naddr — the runtime refuses to act on anything else — and
    // a bare string, which is what tells it this is a change.
    expect(call.naddr).toBe(ISSUE_NADDR)
    expect(typeof call.value).toBe('string')
  })

  it('opens on the status the issue actually has', async () => {
    // Publishing "todo" over "todo" is harmless; publishing the vocabulary's
    // first entry over a status somebody set is not.
    open()
    await userEvent.click(await screen.findByText('Set status'))
    expect(await screen.findByText('Todo')).toBeInTheDocument()
  })

  it('offers nothing when the launcher was not invoked from a thread', async () => {
    // The registry is cleared on unmount for this reason: acting on an object
    // the person is not looking at is the failure PEE-1 was careful to avoid.
    open({ composer: { isFocused: true, hasDraft: false } })
    await screen.findByText('Apps')
    expect(screen.queryByText('In this conversation')).not.toBeInTheDocument()
  })

  it('drops a reference that will not resolve rather than offering a dead row', async () => {
    // The person may simply not be able to read it. An action row for an
    // object nobody can fetch is a row that cannot succeed.
    resolveObject.mockResolvedValue(null)
    open()
    await screen.findByText('Apps')
    expect(screen.queryByText('In this conversation')).not.toBeInTheDocument()
  })

  it('drops a non-addressable object, which has nothing to act on', async () => {
    /*
      A regular event — a Peek message — has no `d` and therefore no naddr, and
      the runtime is explicit that a consumer without one correctly offers no
      actions. Offering them anyway would produce a change with nothing to
      address.
    */
    resolveObject.mockResolvedValue({ ...ISSUE, naddr: undefined } as unknown as ForeignObject)
    open()
    await screen.findByText('Apps')
    expect(screen.queryByText('In this conversation')).not.toBeInTheDocument()
  })

  it('surfaces the relay’s refusal instead of closing on it', async () => {
    applyAction.mockResolvedValueOnce({ ok: false, reason: 'done is not one of todo, in_progress' })
    const { onClose } = open()
    await userEvent.click(await screen.findByText('Set status'))
    await userEvent.click(await screen.findByRole('button', { name: 'Set status' }))

    expect(await screen.findByText(/not one of todo/i)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
