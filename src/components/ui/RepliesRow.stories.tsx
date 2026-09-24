import type { Meta, StoryObj } from '@storybook/react-vite'
import { RepliesRow } from './RepliesRow'

const meta = {
  title: 'Messages/RepliesRow',
  component: RepliesRow,
  args: {
    replyCount: 3,
    replyAuthors: [{ name: 'Alice Johnson' }, { name: 'Jake Walter' }, { name: 'Zack Bright' }],
    lastReplyTime: '12:42 PM',
  },
  decorators: [(Story) => <div className="w-[560px]">{Story()}</div>],
} satisfies Meta<typeof RepliesRow>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** One reply: the word agrees. */
export const OneReply: Story = { args: { replyCount: 1, replyAuthors: [{ name: 'Alice Johnson' }] } }

/** A reply the reader has not seen. */
export const NewReply: Story = { args: { hasNewReply: true } }

/** A new reply in an urgent thread: the chip in the warning colour. */
export const NewUrgentReply: Story = { args: { hasNewReply: true, isUrgent: true } }
