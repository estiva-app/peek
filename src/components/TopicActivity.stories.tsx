import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { fn } from 'storybook/test'
import { PeekDataProvider } from '@/api'
import { TopicActivity, type TopicActivityItem } from './TopicActivity'

/**
 * Activity — the conversations of files related to this topic (CON-9).
 *
 * On production this holds 93% of what used to be in a paired topic's stream:
 * Ship publishes a comment into the project's Folder, which *is* the topic's
 * channel, so every ticket comment ever written arrived here as an ordinary
 * message with nothing saying which file it was about.
 */
const TICKET_A = '30851:aa:pay-1'
const TICKET_B = '30851:aa:rel-4'

const item = (id: string, authorName: string, timestamp: string, body: string, about?: string): TopicActivityItem => ({
  about,
  conv: { id, authorName, timestamp, body, nostrReferences: about ? [about] : undefined },
})

const ITEMS: TopicActivityItem[] = [
  item('c1', 'Ravi Mehta', '11:08 AM', 'Blocked on the Stripe key — Ana has it in 1Password.', TICKET_A),
  item('c2', 'Ana Duarte', 'Yesterday', 'Down to one fold per read. The second pass was the re-linked project.', TICKET_B),
  item('c3', 'Mara Sato', 'Monday', 'Reopening — the archived one still lands last after a reload.', TICKET_A),
]

const LABELS = new Map([
  [TICKET_A, 'Billing entry + add payment method'],
  [TICKET_B, 'Fold the change stream once per read'],
])

/** The topic a mention was said in — `39000:<relay>:<uuid>` (CON-11). */
const OTHER_TOPIC = '39000:bb:leaf-planning'

const MENTIONS: TopicActivityItem[] = [
  {
    relation: 'mention',
    about: OTHER_TOPIC,
    href: '/topic/leaf-planning',
    conv: {
      id: 'm1',
      authorName: 'Miky',
      timestamp: 'Wed',
      body: 'Parking the billing question until the Stripe key lands — see nostr:naddr1… for where that stands.',
      nostrReferences: ['39000:bb:this-topic'],
    },
  },
]

const LABELS_WITH_MENTION = new Map([...LABELS, [OTHER_TOPIC, 'Leaf planning']])

const meta = {
  title: 'To be removed/TopicActivity',
  component: TopicActivity,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PeekDataProvider>
          {/*
          The real column, copied from `PeekFrame`: `w-[380px]`. Activity lives in
          the Folder panel beside the files it is about, not in a tab, so a wider
          frame here would review a layout the app never draws — and the width is
          exactly what decides whether a ticket title and a message body wrap.
        */}
        <div className="w-[380px] h-[560px] flex flex-col bg-bg-base">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: { items: ITEMS, labelFor: LABELS, onOpenThread: fn() },
} satisfies Meta<typeof TopicActivity>

export default meta
type Story = StoryObj<typeof meta>

/** Three ticket conversations, each naming the file it belongs to. */
export const Default: Story = {}

/** One row selected — its thread is open in the panel beside this. */
export const ThreadOpen: Story = { args: { selectedId: 'c1' } }

/**
 * The second relation — CON-11. A message in another topic named this one, so
 * it is here, labelled *Mentioned in* with that topic's title, and drawn
 * lighter: the hairline alone, no fill, because a mention is anyone typing
 * your address and does not carry a sub-file thread's trust. It sits in the
 * one list in time order, not in a section of its own.
 */
export const WithMention: Story = {
  args: { items: [ITEMS[0], MENTIONS[0], ITEMS[1], ITEMS[2]], labelFor: LABELS_WITH_MENTION },
}

/**
 * The Folder has not resolved yet, so no ticket has a name.
 *
 * The row draws the chip and no label rather than a placeholder: "Loading…"
 * beside a real message reads worse than a row that has simply not said where
 * it is from yet.
 */
export const NamesNotResolved: Story = { args: { labelFor: new Map() } }

/** A Folder whose files nobody has commented on. Says what would appear, not "no data". */
export const Empty: Story = { args: { items: [] } }
