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
 * The first half of this file asserts the launcher stops claiming they do.
 *
 * **One of the three works now.** Peek declares `start-a-conversation`, so the
 * row is back and it publishes — interop 0.16.0 resolves a channel record to
 * its own `d`, which is what gives an action on a topic somewhere to write
 * (0 of 40 `kind:39000` events on production carry `h` or `buzz-channel`).
 *
 * The other two stay absent and are asserted absent. Ship's `add-project` and
 * Peek's `create-topic` each create a container that does not exist yet, which
 * is FOL-2 — so a row for either would be exactly the promise this file exists
 * to stop the launcher making.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { FOLDER_ACTIONS_ADDRESS, type ResolvedAction } from '@estiva-app/interop'
import { PeekDataProvider } from '@/api'
import { DebugProvider } from '@/lib/debug'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
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

/**
 * A Folder's Start a conversation — Peek's manifest declared it (INT-9) until
 * interop 0.58 made it the Folder's built-in (SPEC §3.2), with `declaredBy`
 * naming the specification.
 *
 * `createsUnder: 'self'` with no link tag — a message names its channel with
 * `h`, which every created event carries anyway, so there is no `setTag` and
 * the containment is the Folder. `target: 'content'` is the body, which is
 * what made a message declarable and what the form draws as prose.
 */
const liveStartConversation: ResolvedAction = {
  id: 'start-a-conversation',
  label: 'Start a conversation',
  description: 'Start a new conversation in this Folder, as a root message that people can then reply to.',
  effect: 'writes',
  control: 'form',
  fields: [{ name: 'message', type: 'string', required: true, target: 'content' }],
  createsUnder: 'self',
  declaredBy: { address: FOLDER_ACTIONS_ADDRESS, appName: 'Folder' },
}

const TOPIC_AUTHOR = '8b75a34d06c8e4ee' + 'f'.repeat(48)
const TOPIC_ID = '53e358c2-0ad7-482c-a951-6f9d48dc71eb'
const RETIRED_CHANNEL = 'e83471a7-cd98-4a62-ac5a-f21e0daedd24'
const DM_ID = '0e2f4c1a-5b6d-4e7f-8a9b-0c1d2e3f4a5b'
const DM = `39000:${TOPIC_AUTHOR}:${DM_ID}`

/*
  Typed by its signature rather than by a named parameter, so the assertions
  below can read the call without the lint rule flagging an unused `_args`.
*/
const applyAction = vi.fn<
  (args: { naddr: string; actionId: string; value: string | Record<string, string> }) => Promise<{
    ok: true
    created: string
  }>
>(async () => ({ ok: true as const, created: `30851:${SHIP_AUTHOR}:x` }))
/** The DM's own message, as its composer sends it (REC-1). */
const startConversationInDm = vi.fn<(args: { channel: string; body: string }) => Promise<{ ok: true; id: string }>>(
  async () => ({ ok: true as const, id: 'e'.repeat(64) }),
)
/*
  Answers per kind, which it has to now that two apps are probed.

  It used to answer every kind with Ship's `add-issue`, and that was fine while
  Ship was the only app carrying a `parentKind`. Peek carries one since INT-9,
  so a kind-blind mock would show Ship's action inside Peek's section and the
  test asserting Peek's own would pass for the wrong reason.
*/
const creatableUnder = vi.fn(async (parentKind: number) => {
  if (parentKind === 30850) {
    return {
      actions: [liveAddIssue],
      parents: [{ address: `30850:${SHIP_AUTHOR}:p1`, title: 'Projection layer' }],
    }
  }
  if (parentKind === 39000) {
    const where = [
      { address: `39000:${TOPIC_AUTHOR}:${TOPIC_ID}`, title: 'Intelligence in Peek' },
      // A retired topic's channel, restored until FOL-25 deletes it — the
      // relay still lists it among the newest `39000`s (FOL-26).
      { address: `39000:${TOPIC_AUTHOR}:${RETIRED_CHANNEL}`, title: 'Folders: Universal navigation concept' },
      // The person's DM, which Peek's picker lists beside their Folders (REC-1).
      { address: DM, title: 'DM' },
    ]
    return {
      actions: [liveStartConversation],
      parents: where,
      manifest: FOLDER_ACTIONS_ADDRESS,
      parentsFor: { 'start-a-conversation': where },
      dms: [DM],
    }
  }
  // An app that declares nothing creatable. Null is what the runtime returns,
  // and the launcher's empty state is what reads it.
  return null
})

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api')
  return {
    ...actual,
    useForeignObjects: () => ({
      resolveObject: vi.fn(),
      resolveFolderProject: vi.fn(),
      applyAction,
      startConversationInDm,
      creatableUnder,
    }),
  }
})

const onClose = vi.fn()

function open(initialAppId: string, initialActionId?: string) {
  render(
    <MemoryRouter initialEntries={['/desk']}>
      <DebugProvider>
        <PeekDataProvider>

        <LastSelectionProvider>

        <ToastProvider>
          <CommandLauncher
            context={{}}
            onClose={onClose}
            initialAppId={initialAppId}
            initialActionId={initialActionId}
          />
        </ToastProvider>

        </LastSelectionProvider>

        </PeekDataProvider>
      </DebugProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  applyAction.mockClear()
  startConversationInDm.mockClear()
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

  it('offers a Folder’s Start a conversation in Peek, and still not Create a topic', async () => {
    /*
      Two of the three rows Miky found dead, and they are dead for different
      reasons — which is why one is back and one is not.

      `start-a-conversation` creates no container: a `kind:9` root lands in the
      topic's own Folder, which interop 0.16.0 can now find. `create-topic`
      creates the Folder, and nothing can express that until FOL-2. So the
      honest launcher shows exactly one of them.
    */
    open('peek')

    expect(await screen.findByText('Start a conversation')).toBeInTheDocument()
    expect(screen.queryByText('Create a topic')).not.toBeInTheDocument()
    // Probed at all, which it was not before: an app with no `parentKind`
    // returns early and offers nothing however much it declares.
    expect(creatableUnder).toHaveBeenCalledWith(39000)
  })

  /*
    Reached by selecting the row rather than by `initialActionId`, deliberately.

    `initialActionId` resolves against the **registry**, so a form opened that
    way draws the design's proposal and would pass these two whatever the live
    conversion did. What is being asserted here is `launcherActionFrom`'s
    reading of a live declaration, so the live row is the only way in.
  */
  async function openLiveConversationForm() {
    open('peek')
    await userEvent.click(await screen.findByText('Start a conversation'))
  }

  it('draws the message body as prose, because the manifest said where it goes', async () => {
    /*
      `target: 'content'` is the only thing in a manifest that distinguishes a
      long string from a short one, so it is the only honest reason to draw a
      textarea — nothing is inferred from the property being called "message".
      A one-line box for a conversation opener is the wrong shape for the thing.
    */
    await openLiveConversationForm()

    const box = await screen.findByLabelText(/message/i)
    expect(box.tagName).toBe('TEXTAREA')
  })

  it('names the parent by the app’s own noun, not every app’s Project', async () => {
    // A person starting a conversation was asked to choose a *Project*: the
    // launcher passed the literal `'project'` for every app it probed.
    await openLiveConversationForm()

    expect(await screen.findByLabelText(/topic/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/project/i)).not.toBeInTheDocument()
  })

  it('never offers a retired topic’s channel as somewhere to start one (FOL-26)', async () => {
    // A `kind:9` into one of the restored channels is what FOL-25 must be sure
    // nothing can write before it deletes them again.
    await openLiveConversationForm()

    await userEvent.click(screen.getByLabelText(/topic/i))
    expect(await screen.findByRole('option', { name: 'Intelligence in Peek' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Folders: Universal navigation concept' })).not.toBeInTheDocument()
  })

  it('publishes a conversation into the topic that was picked', async () => {
    /*
      The positive assertion, which is the one this file went without for the
      three dead rows: a suite of "must not publish" passes identically against
      a form that cannot.

      `value` carries the declared property and nothing else — the parent is not
      a property, it travels as the address the runtime resolves the manifest
      and the Folder from.
    */
    await openLiveConversationForm()

    await userEvent.type(await screen.findByLabelText(/message/i), 'Shall we split PRO-18?')
    await userEvent.click(screen.getByLabelText(/topic/i))
    // By role: text also finds the option in the list before it has opened
    // (see `createIssue` in CommandLauncher.live.test.tsx).
    await userEvent.click(await screen.findByRole('option', { name: 'Intelligence in Peek' }))
    // Exact, not a pattern: the form's chip carries a "Leave Start a
    // conversation" button that a loose match also finds.
    await userEvent.click(screen.getByRole('button', { name: 'Start a conversation' }))

    expect(applyAction).toHaveBeenCalledTimes(1)
    const call = applyAction.mock.calls[0]?.[0] as Parameters<typeof applyAction>[0] & { declaredBy?: string }
    expect(call?.actionId).toBe('start-a-conversation')
    expect(call?.value).toEqual({ message: 'Shall we split PRO-18?' })
    expect(call?.naddr.startsWith('naddr')).toBe(true)
    // The Folder's own action, built with the specification's manifest — Peek's declares none (REC-1).
    expect(call?.declaredBy).toBe(FOLDER_ACTIONS_ADDRESS)
    expect(startConversationInDm).not.toHaveBeenCalled()
  })

  it('starts a conversation in a DM as the DM’s own message, not as the Folder’s action (REC-1)', async () => {
    // A DM is no Folder, so the Folder's Start a conversation is not for it; Peek's chat code sends it.
    await openLiveConversationForm()

    await userEvent.type(await screen.findByLabelText(/message/i), 'Lunch at one?')
    await userEvent.click(screen.getByLabelText(/topic/i))
    await userEvent.click(await screen.findByRole('option', { name: 'DM' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start a conversation' }))

    expect(startConversationInDm).toHaveBeenCalledTimes(1)
    expect(startConversationInDm.mock.calls[0]?.[0]).toEqual({ channel: DM_ID, body: 'Lunch at one?' })
    expect(applyAction).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('offers nothing for an app that declares nothing, and says which app', async () => {
    /*
      The empty state is still reachable and still has to name the app — an
      unexplained blank reads as "this app does nothing", which is a different
      and wrong statement. Peek used to be this case; it is now an app whose
      manifest declares nothing creatable under its parent kind.
    */
    creatableUnder.mockResolvedValueOnce(null)
    open('ship')

    expect(await screen.findByText(/ship has not published anything to create here yet/i)).toBeInTheDocument()
    expect(screen.queryByText('Add issue')).not.toBeInTheDocument()
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
    // Ship's proposal, which this relay's Ship does not declare. (It was Peek's
    // `create-topic` until INT-12 made that a Folder's built-in.)
    open('ship', 'add-project')

    await userEvent.type(await screen.findByLabelText(/name/i), 'Weekly planning')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByText(/has not published this action/i)).toBeInTheDocument()
    expect(applyAction).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
