import type { Meta, StoryObj } from '@storybook/react-vite'
import type { People } from '@estiva-app/interop'
import { FileThreadView } from './FileThreadView'

/**
 * A thread under one comment on a file another app owns (FOL-19).
 *
 * The fixture is a **Ship issue's** discussion, for the reason the conversation
 * pane's is: it is the case the aspects model claims Peek can now render whole.
 * Nothing here knows it is Ship — the replies were read by `#e` against the
 * comment kinds Ship's manifest declares, so an app nobody has written arrives
 * in exactly this shape.
 *
 * The three states worth seeing are the three that are easy to conflate: a read
 * still running, a comment nobody answered, and a thread that could not be read
 * at all. Drawing the last as the second is the defect this codebase keeps
 * finding — it is how a refused read became "no folders yet".
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const CATH = 'a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697'
const HOUR = 3600
const now = Math.floor(Date.now() / 1000)

const PEOPLE: People = {
  [CATH]: { displayName: 'Cath' },
  // No entry for SHIP on purpose: an author with no kind:0 draws a short key.
}

const ROOT = {
  id: 'root-1',
  author: CATH,
  body: 'Should the file route keep the `/topic/` prefix, or get one of its own?',
  createdAt: now - 4 * HOUR,
}

const reply = (id: string, author: string, body: string, ago: number) => ({
  id,
  author,
  body,
  createdAt: now - ago,
  kind: 1111,
})

const meta = {
  title: 'Views/FileThreadView',
  component: FileThreadView,
  parameters: { layout: 'centered' },
  args: { root: ROOT, people: PEOPLE },
  decorators: [
    Story => (
      <div className="w-[380px] bg-bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FileThreadView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    state: {
      roots: {},
      replies: {
        [ROOT.id]: [
          reply('r1', SHIP, 'Keeping it means every link in the wild still opens.', 3 * HOUR),
          reply('r2', CATH, 'Agreed — an address has two colons, a slug has none.', 2 * HOUR),
        ],
      },
    },
  },
}

/** Nobody has answered. A real fact, and not the same as the one below. */
export const NoReplies: Story = {
  args: { state: { roots: {}, replies: {} } },
}

/** The read is still out. A skeleton, never a sentence (§4.7). */
export const Loading: Story = {
  args: { state: 'loading' },
}

/**
 * The relay refused. Said as its own sentence, because "no replies yet" here
 * would be an assertion about a conversation nobody managed to read.
 */
export const Unreadable: Story = {
  args: { state: { failed: 'not_a_member' } },
}
