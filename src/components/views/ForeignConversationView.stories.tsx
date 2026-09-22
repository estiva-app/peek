import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ForeignObject, People } from '@estiva-app/interop'
import { ForeignConversationView } from './ForeignConversationView'

/**
 * A file's conversation, drawn by Peek, owned by another app (RFC 0.5 §10).
 *
 * The fixture is a **Ship project's** discussion, because that is the case §10.1
 * says was impossible and which facets existed to work around: *"they were only
 * ever two things because Peek could not render a project's conversation."* If
 * this panel is convincing, the withdrawal in §10 is sound and FOL-3 is tidy-up.
 *
 * Nothing in the component knows it is Ship. The comment kinds came off Ship's
 * manifest during the read (`emits: { kind: 1111, scope: 'address',
 * alsoRead: [9] }`), so a Leaf document or an app nobody has written yet arrives
 * in exactly this shape — which is why there is no second fixture per app here.
 * The one thing worth varying is *who* the authors are, and whether they have
 * published a name.
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const HOUR = 3600

/** Nostr seconds, which is what a resolved comment carries. */
const now = Math.floor(Date.now() / 1000)

const PEOPLE: People = {
  [CATH]: { displayName: 'Cath' },
  // No entry for SHIP on purpose — see `Unnamed`.
}

const project = (comments: ForeignObject['comments']): ForeignObject =>
  ({
    ref: `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`,
    address: `30850:${SHIP}:0ebd5fdd-c58a-416e-b8a7-cbdcec77b77f`,
    naddr: 'naddr1',
    eventId: 'e',
    kind: 30850,
    widget: 'card',
    appName: 'Estiva Ship',
    slots: { title: { value: 'Folders: navigation for the whole suite' } },
    meta: [],
    comments,
    actions: [],
    viaRecommendation: true,
  }) as ForeignObject

const meta = {
  title: 'Messages/ForeignConversationView',
  component: ForeignConversationView,
  decorators: [
    (Story) => (
      <div className="w-[420px] bg-bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ForeignConversationView>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The claim, rendered: a Ship project's discussion inside Peek.
 *
 * Oldest first, because this is a conversation and not a change log — the
 * opposite of `ActivityTimeline`, which is read newest-first.
 */
export const AProjectsConversation: Story = {
  args: {
    people: PEOPLE,
    state: project([
      {
        id: 'c1',
        author: CATH,
        body: 'Renamed and rescoped — teams, nesting, then labels.',
        createdAt: now - 30 * HOUR,
      },
      {
        id: 'c2',
        author: SHIP,
        body: 'Folder state is relay-signed now, so the peers agree outside Ship too.',
        createdAt: now - 4 * HOUR,
      },
      {
        id: 'c3',
        author: CATH,
        body: 'Then the last unproven leg is the browser one.',
        createdAt: now - 40 * 60,
      },
    ]),
  },
}

/**
 * A conversation with threads under it — the manner FOL-19 added and FOL-25 met.
 *
 * The fixture is the shape of a migrated topic: most comments have nothing
 * under them, a few carry most of the discussion. It exists because the thread
 * affordance shipped without one — nothing rendered `replyCounts` or
 * `onOpenThread`, so nobody saw that 31 of a file's 50 messages had become
 * seven unlabelled icons until somebody opened the page on production.
 */
export const WithThreads: Story = {
  args: {
    people: PEOPLE,
    onOpenThread: () => {},
    replyCounts: { c1: 9, c3: 2 },
    state: project([
      {
        id: 'c1',
        author: CATH,
        body: 'Renamed and rescoped — teams, nesting, then labels.',
        createdAt: now - 30 * HOUR,
      },
      {
        id: 'c2',
        author: SHIP,
        body: 'Folder state is relay-signed now, so the peers agree outside Ship too.',
        createdAt: now - 4 * HOUR,
      },
      {
        id: 'c3',
        author: CATH,
        body: 'Then the last unproven leg is the browser one.',
        createdAt: now - 40 * 60,
      },
    ]),
  },
}

/**
 * The thread that is open in the pane beside this one, marked on its own row.
 */
export const ThreadOpen: Story = {
  args: { ...WithThreads.args, openThreadId: 'c1' },
}

/**
 * An author with no `kind:0`, shown as a shortened key rather than "Unknown".
 *
 * Two unnamed authors both called Unknown cannot be told apart, and one of them
 * here is a *relay* rather than a person — the folder state is relay-signed, so
 * this is the ordinary case on today's data and not a defensive branch.
 */
export const Unnamed: Story = {
  args: {
    state: project([
      { id: 'c1', author: SHIP, body: 'Accepted, and the state event followed.', createdAt: now - HOUR },
    ]),
  },
}

/**
 * Nothing said yet — and this sentence is only allowed after a read that worked.
 */
export const NothingSaidYet: Story = { args: { people: PEOPLE, state: project([]) } }

/**
 * The distinction the whole component exists to keep.
 *
 * A refused read has the same number of messages as a file nobody has commented
 * on, and rendering it as `NothingSaidYet` would assert an empty conversation on
 * the strength of a request that never arrived. That is not hypothetical: on
 * 2026-09-10 a CORS-blocked relay read rendered as an empty folder list, and the
 * same failure would render here as an empty thread.
 */
export const CouldNotBeRead: Story = {
  args: { people: PEOPLE, state: { failed: 'unreachable' } },
}

/**
 * Resolved to nothing, which is deliberately not given a reason.
 *
 * `resolveObject` returns `null` for a signed-out viewer, an unreadable
 * manifest and a reference no app claims. Three sentences, one return value —
 * so this stays on the unreadable side of the line rather than picking one.
 */
export const Unresolved: Story = { args: { people: PEOPLE, state: 'unresolved' } }

/** Still resolving. The relay read is an action, not a reactive query. */
export const Loading: Story = { args: { state: 'loading' } }
