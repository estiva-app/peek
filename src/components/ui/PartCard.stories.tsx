import type { Meta, StoryObj } from '@storybook/react-vite'
import { markerTextToBlockDocument, type Block } from '@estiva-app/protocol'
import type { ForeignObject } from '@estiva-app/interop'
import { PartCardView } from './PartCard'

/**
 * One block of another object, live inside a message (SPEC §13.6.1, COM-2).
 *
 * `PartCard` reads the block from the relay and draws `PartCardView`. The read
 * needs a relay and a token, so these stories draw the view with each answer
 * the read can give.
 */
const AUTHOR = 'f'.repeat(64)
const UUID = '742cfe0e-23a2-4940-b5ef-bebab0c46902'
const ADDRESS = `30851:${AUTHOR}:${UUID}`
const LINK = `https://ship.estiva.app/issue/plan-the-launch-${UUID}#block-p1`

const issue = {
  ref: ADDRESS,
  address: ADDRESS,
  kind: 30851,
  widget: 'card',
  noun: 'issue',
  appName: 'Estiva Ship',
  slots: { title: { value: 'Plan the launch', field: 'title' } },
  meta: [],
  openUrl: 'https://ship.estiva.app/issue/plan-the-launch',
} as unknown as ForeignObject

/** Every block carries an id (§13.3); a table's rows and cells are blocks too. */
let next = 0
const withIds = (node: Record<string, unknown>): Block =>
  (node.type === 'text'
    ? node
    : { ...node, id: `b${next++}`, ...(Array.isArray(node.content) ? { content: node.content.map(withIds) } : {}) }) as unknown as Block
const paragraph = (text: string): Block => markerTextToBlockDocument(text).content[0]
const table = (rows: string[][]): Block =>
  withIds({
    type: 'table',
    content: rows.map((row, i) => ({
      type: 'tableRow',
      content: row.map((text) => ({ type: i === 0 ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })),
    })),
  })

const PICTURE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270"><rect width="480" height="270" fill="#1b1d22"/><rect x="24" y="24" width="120" height="222" rx="8" fill="#26292f"/><rect x="160" y="24" width="296" height="40" rx="8" fill="#26292f"/><rect x="160" y="80" width="296" height="166" rx="8" fill="#2f333a"/><circle cx="210" cy="140" r="26" fill="#8b5cf6"/><rect x="250" y="126" width="170" height="12" rx="6" fill="#52525b"/></svg>',
  )

const LONG =
  'The launch plan. We ship the new onboarding on Friday, with the Folder picker, the member list and the first-run tips. Katerina reviews the screens on Thursday morning; anything she flags that changes what a person sees moves the date rather than shipping half. Miky writes the announcement and the two scenarios it leads with, and the support notes go out with the release, not after it. If the relay deploy slips, the release waits for it: a client that expects the new rules against an old relay is worse than a day late. Everyone who is on call that weekend is named in the rota before Thursday, and the rota is linked from the topic. The first week after the release, support questions go to the topic rather than to anyone directly, so the answers are written down once and found by the next person who asks. On Monday we read what came in and decide what the first fix release carries.'

const meta = {
  title: 'Messages/ForeignObject/PartCard',
  component: PartCardView,
  parameters: { layout: 'padded' },
  args: { address: ADDRESS, block: 'p1', fetchImage: (url: string) => Promise.resolve(url) },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PartCardView>

export default meta
type Story = StoryObj<typeof meta>

/** A short paragraph, drawn whole, with the way into Ship at the foot. */
export const Paragraph: Story = {
  args: { view: { state: 'resolved', block: paragraph('We ship the new onboarding on Friday.'), object: issue, link: LINK } },
}

/** A short table is drawn whole. */
export const Table: Story = {
  args: { view: { state: 'resolved', block: table([['Owner', 'Due'], ['Miky', 'Friday'], ['Katerina', 'Thursday']]), object: issue, link: LINK } },
}

/** A long block is cut behind ShowMore's fade; Show more opens it in place. */
export const Long: Story = {
  args: { view: { state: 'resolved', block: paragraph(LONG), object: issue, link: LINK } },
}

/** A long table is cut the same way. */
export const LongTable: Story = {
  args: {
    view: {
      state: 'resolved',
      block: table([
        ['Step', 'Owner', 'Due'],
        ['Screens', 'Katerina', 'Thu'],
        ['Announcement', 'Miky', 'Thu'],
        ['Support notes', 'Jan', 'Fri'],
        ['Relay deploy', 'Miky', 'Fri'],
        ['Release', 'Everyone', 'Fri'],
        ['Retro', 'Everyone', 'Mon'],
      ]),
      object: issue,
      link: LINK,
    },
  },
}

/** A picture is its attachment card, never cut; a click opens it full. */
export const Picture: Story = {
  args: {
    view: {
      state: 'resolved',
      block: withIds({ type: 'attachment', attrs: { url: PICTURE, m: 'image/png', filename: 'onboarding-first-run.png', size: 412_000 } }),
      object: issue,
      link: LINK,
    },
  },
}

/** The app gave no link: no way in is offered. */
export const WithoutALink: Story = {
  args: { view: { state: 'resolved', block: paragraph('We ship the new onboarding on Friday.'), object: issue } },
}

/** Waiting for the first read: the same placeholder a Ship card has. */
export const Loading: Story = { args: { view: { state: 'loading' } } }

/** The block was taken out of a description the reader can still read. */
export const PartDeleted: Story = { args: { view: { state: 'detached', object: issue, link: LINK } } }

/** A comment on several paragraphs (§13.6, LEAF-7): the card draws every one of them. */
export const CommentOnARun: Story = {
  args: {
    view: {
      state: 'resolved',
      block: paragraph('We ship the new onboarding on Friday.'),
      run: [paragraph('We ship the new onboarding on Friday.'), paragraph('QA signs off on Thursday.')],
      object: issue,
      link: LINK,
    },
  },
}

/**
 * The words a comment quoted are no longer in its paragraphs (§13.6 `reworded`):
 * the card stays beside them and says what the commenter quoted, never as
 * deleted. The look is Katerina's to set.
 */
export const WordsChanged: Story = {
  args: {
    view: {
      state: 'reworded',
      block: paragraph('We ship the new onboarding next week.'),
      run: [paragraph('We ship the new onboarding next week.'), paragraph('QA signs off on Thursday.')],
      quote: { start: 'on Friday.', end: 'QA signs' },
      object: issue,
      link: LINK,
    },
    quotedBy: 'QA-1',
  },
}

/** The object's body is not written in blocks, so no block of it can be shown. */
export const CantBeShown: Story = { args: { view: { state: 'unaddressable', object: issue, link: LINK } } }

/** The whole object is gone: no title, because there is nothing left to name. */
export const Deleted: Story = { args: { view: { state: 'deleted' } } }

/** The reader is not in the object's Folder: no title, no text, a dashed frame. */
export const NotAvailable: Story = { args: { view: { state: 'unreadable' } } }
