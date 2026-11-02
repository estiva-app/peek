import type { Meta, StoryObj } from '@storybook/react-vite'
import { avatarFor } from '@/api'
import { TopicState } from './TopicState'

const meta = {
  title: 'Topics/TopicState',
  component: TopicState,
  args: {
    type: 'topic',
    status: 'default',
  },
  argTypes: {
    type: { control: 'inline-radio', options: ['topic', 'DM', 'folder', 'project', 'issue', 'file'] },
    status: { control: 'inline-radio', options: ['unresolved', 'resolved', 'default'] },
  },
} satisfies Meta<typeof TopicState>

export default meta
type Story = StoryObj<typeof meta>

export const Topic: Story = {}

/** Resolved topics always show the green check, regardless of icon color overrides. */
export const TopicResolved: Story = {
  args: { status: 'resolved' },
}

export const Dm: Story = {
  args: { type: 'DM', avatarSrc: avatarFor('Alice Johnson') },
}

/** Every type at a glance (topic shown unresolved and resolved). */
export const AllTypes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-center gap-4">
      {(
        [
          { label: 'topic', node: <TopicState type="topic" /> },
          { label: 'resolved', node: <TopicState type="topic" status="resolved" /> },
          { label: 'DM', node: <TopicState type="DM" avatarSrc={avatarFor('Alice Johnson')} /> },
          { label: 'folder', node: <TopicState type="folder" /> },
          { label: 'project', node: <TopicState type="project" /> },
          { label: 'issue', node: <TopicState type="issue" /> },
          { label: 'file', node: <TopicState type="file" /> },
        ] as const
      ).map(({ label, node }) => (
        <div key={label} className="flex flex-col items-center gap-1.5">
          {node}
          <span className="text-caption text-text-muted">{label}</span>
        </div>
      ))}
    </div>
  ),
}
