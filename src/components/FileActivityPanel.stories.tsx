import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import { PeekDataProvider } from '@/api'
import { FileActivityPanelView } from './FileActivityPanel'
import type { TopicActivityItem } from './TopicActivity'

/**
 * A file page's Activity — the comments elsewhere that name this file (CON-11).
 *
 * Every row is a mention: said on another file, drawn `subdued`, opening the
 * thread it was said in. The file it was said on is named beside the chip
 * once its title has resolved, and the row is drawn without the name until
 * then rather than held back for it.
 */
const ROADMAP = '30840:aa:roadmap'
const NOTES = '30840:aa:launch-notes'

const ITEMS: TopicActivityItem[] = [
  {
    relation: 'mention',
    about: ROADMAP,
    href: '/topic/30840:aa:roadmap?thread=m1',
    conv: {
      id: 'm1',
      authorName: 'Miky',
      timestamp: '11:08 AM',
      body: 'The billing question is parked until the Stripe key lands — nostr:naddr1… has where that stands.',
      nostrReferences: ['30840:aa:this-file'],
    },
  },
  {
    relation: 'mention',
    about: NOTES,
    href: '/topic/30840:aa:launch-notes?thread=root-7',
    conv: {
      id: 'm2',
      authorName: 'Ana Duarte',
      timestamp: 'Yesterday',
      body: 'Same shape as nostr:naddr1…, one level down.',
      nostrReferences: ['30840:aa:this-file'],
    },
  },
]

const meta = {
  title: 'Messages/FileActivityPanel',
  component: FileActivityPanelView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PeekDataProvider>
          {/* The third column, copied from `AppShell`: `w-[380px]`, where a thread would otherwise open. */}
          <div className="w-[380px] h-[560px] flex flex-col bg-bg-base">
            <Story />
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: { items: ITEMS, labelFor: new Map([[ROADMAP, 'Roadmap'], [NOTES, 'Launch notes']]) },
} satisfies Meta<typeof FileActivityPanelView>

export default meta
type Story = StoryObj<typeof meta>

/** Two mentions, each naming the file it was said on. */
export const Mentions: Story = {}

/** The titles have not resolved yet: the chip alone says how the row is related. */
export const TitlesResolving: Story = { args: { labelFor: new Map() } }
