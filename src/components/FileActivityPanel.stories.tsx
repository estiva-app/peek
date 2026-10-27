import { useEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '@estiva-app/ui'
import { PeekDataProvider, type ConversationData } from '@/api'
import { FileActivityPanelView } from './FileActivityPanel'
import type { TopicActivityItem } from './TopicActivity'

/**
 * A file's Activity — the comments elsewhere that name this file (CON-11), a
 * section of its Overview (`OverviewPanel`), its count beside the title.
 *
 * Every row is a mention (PEE-48): a message said somewhere else, shown as it
 * is now and drawn `subdued`. Nothing on it acts on the message — no menu, no
 * reply, no reaction to toggle, no resolve. A click opens the message where it
 * was said, with its thread; here that is a stand-in page naming the place,
 * with Back. The file it was said on is named beside the chip once its title
 * has resolved, and the row is drawn without the name until then.
 */
const DM = '39000:relay:dm-miky'
const UPDATES = '39000:relay:suits-updates'
const ROADMAP = '30840:aa:roadmap'

const PLACES: Record<string, string> = {
  m1: 'your DM with Miky',
  m2: 'the topic Estiva Suits Updates',
  m3: 'the file Roadmap',
}

const EDITED_AT = Date.now() - 3_600_000

const IN_DM: ConversationData = {
  id: 'm1',
  authorName: 'Katerina Kelepouri',
  timestamp: '8:16 PM',
  body: "@Miky it's done. It's very basic and needs more improvements, but the topics view is flat now. I wrote an update in nostr:naddr1…",
  nostrReferences: ['30840:aa:this-file'],
}

const IN_TOPIC: ConversationData = {
  id: 'm2',
  authorName: 'Miky',
  timestamp: '11:08 AM',
  body: 'The billing question is parked until the Stripe key lands — nostr:naddr1… has where that stands.',
  nostrReferences: ['30840:aa:this-file'],
  reactions: [
    { emoji: '👍', by: ['Ana Duarte', 'Jan Mikula'] },
    { emoji: '🎉', by: ['You'] },
  ],
  replyCount: 3,
  replyAuthors: [{ name: 'Ana Duarte' }, { name: 'Jan Mikula' }],
  lastReplyTime: '2:40 PM',
}

const ON_FILE: ConversationData = {
  id: 'm3',
  authorName: 'Ana Duarte',
  timestamp: 'Yesterday',
  body: 'Same shape as nostr:naddr1…, one level down.',
  nostrReferences: ['30840:aa:this-file'],
  editedAt: EDITED_AT,
  isResolved: true,
  resolvedBy: 'Miky',
  resolutionMessage: 'Moved under the Roadmap file.',
}

const row = (conv: ConversationData, about: string): TopicActivityItem => ({
  relation: 'mention',
  about,
  href: `/message/${conv.id}`,
  conv,
})

const ITEMS: TopicActivityItem[] = [row(IN_DM, DM), row(IN_TOPIC, UPDATES), row(ON_FILE, ROADMAP)]
const LABELS = new Map([
  [DM, 'DM'],
  [UPDATES, 'Estiva Suits Updates'],
  [ROADMAP, 'Roadmap'],
])

/** Where a click lands, in the prototype: the real page opens the DM, topic or file with the thread on this message. */
function Opened() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  return (
    <EmptyState
      message={`Opens the message in ${PLACES[id] ?? 'the place it was said'}, with its thread open on it.`}
      action={{ label: 'Back', onClick: () => navigate(-1) }}
    />
  )
}

const meta = {
  title: 'Folders/FileActivityPanel',
  component: FileActivityPanelView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <PeekDataProvider>
          {/* The third column, copied from `PeekFrame`: `w-[380px]`, where a thread would otherwise open. */}
          <div className="w-[380px] h-[560px] flex flex-col bg-bg-base">
            <Routes>
              <Route path="/message/:id" element={<Opened />} />
              <Route path="*" element={<Story />} />
            </Routes>
          </div>
        </PeekDataProvider>
      </MemoryRouter>
    ),
  ],
  args: { items: ITEMS, labelFor: LABELS },
} satisfies Meta<typeof FileActivityPanelView>

export default meta
type Story = StoryObj<typeof meta>

/** Said in a DM, in a topic and on a file: a click on any opens that message where it was said. */
export const Mentions: Story = {}

/**
 * The message as it is now, while the row is on screen: edited at 2s, a
 * reaction at 4s, a reply at 6s, resolved at 8s, then it starts again.
 * Nothing on the row can make these changes; they are made where it was said.
 */
export const ChangesWhileOpen: Story = {
  render: (args) => <ChangingRow {...args} />,
}

function ChangingRow(args: Parameters<typeof FileActivityPanelView>[0]) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => (s + 1) % 5), 2000)
    return () => clearInterval(timer)
  }, [])
  const conv: ConversationData = {
    ...IN_DM,
    ...(step >= 1 && { body: "@Miky it's done. Basic for now, but the topics view is flat. Update in nostr:naddr1…", editedAt: EDITED_AT }),
    ...(step >= 2 && { reactions: [{ emoji: '👍', by: ['Miky'] }] }),
    ...(step >= 3 && { replyCount: 1, replyAuthors: [{ name: 'Miky' }], lastReplyTime: 'Just now' }),
    ...(step >= 4 && { isResolved: true, resolvedBy: 'Miky', resolutionMessage: 'Looks good, merging.' }),
  }
  return <FileActivityPanelView {...args} items={[row(conv, DM)]} />
}

/** The titles have not resolved yet: the chip alone says how the row is related. */
export const TitlesResolving: Story = { args: { labelFor: new Map() } }

/** Nobody has named the file: the empty line, 4px under the heading. */
export const NothingYet: Story = { args: { items: [] } }
