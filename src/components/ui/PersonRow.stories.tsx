import type { Meta, StoryObj } from '@storybook/react-vite'
import { PersonRow } from './PersonRow'

const meta = {
  title: 'Frame/PersonRow',
  component: PersonRow,
  args: {
    name: 'Alice Johnson',
    type: 'DM',
  },
  argTypes: {
    type: { control: 'inline-radio', options: ['topic', 'DM', 'team', 'group', 'view', 'huddle'] },
    topicStatus: { control: 'inline-radio', options: ['unresolved', 'resolved', 'default'] },
  },
  render: args => (
    <div className="w-72">
      <PersonRow {...args} />
    </div>
  ),
} satisfies Meta<typeof PersonRow>

export default meta
type Story = StoryObj<typeof meta>

export const Dm: Story = {}

export const Topic: Story = {
  args: { name: 'CI/CD pipeline stuck during build stage', type: 'topic' },
}

export const TopicResolved: Story = {
  args: { name: 'Remote work policy clarifications', type: 'topic', topicStatus: 'resolved' },
}

export const Group: Story = {
  args: { name: 'Design crit', type: 'group', memberCount: 4 },
}

/** Team row — users icon (the People page "Teams" section). */
export const Team: Story = {
  args: { name: 'Account Management', type: 'team' },
}

/** Saved-view row. */
export const View: Story = {
  args: { name: 'My mentions', type: 'view' },
}

export const Selected: Story = {
  args: { isSelected: true },
}

/** Unread: medium weight, primary text, accent dot. */
export const Unread: Story = {
  args: { isUnread: true },
}

/** Urgent is a modifier of unread — the warning badge only shows while unread. */
export const UrgentUnread: Story = {
  args: { isUnread: true, isUrgent: true },
}

/** Hover swaps the right slot for actions; onRemove turns the 3-dot into an X. */
export const WithRemove: Story = {
  args: { name: 'Launch checklist for v2', type: 'topic', onRemove: () => {} },
}

/** A DM row with a channel on the relay (DMS-6): hover shows the 3-dot, and its menu offers "Hide conversation". */
export const DmHideable: Story = {
  args: { name: 'Amie Miles', type: 'DM', onHideDm: () => {} },
}

/** A file the person is a member of, at rest (§11.8): the quiet bell says this row can light; hover swaps it for the menu, whose item reads "Leave". */
export const Joined: Story = {
  args: { name: 'The file route', type: 'file', memberAction: 'leave', onToggleMember: () => {} },
}

/** A member and unread: the dot wins the slot — the bell is only for a member row with nothing new. */
export const JoinedUnread: Story = {
  args: { name: 'The file route', type: 'file', isUnread: true, memberAction: 'leave', onToggleMember: () => {} },
}

/** Not a member: nothing in the slot at rest, and the menu offers "Join". */
export const NotJoined: Story = {
  args: { name: 'The file route', type: 'file', memberAction: 'join', onToggleMember: () => {} },
}

/** A file in the Folders tree, as `FileTreeView` draws it: press the ⋮ for Details, Rename, New topic inside, Move and Delete. */
export const FileWithControls: Story = {
  args: {
    name: 'The file route',
    type: 'file',
    onOpenDetails: () => {},
    onRename: () => {},
    onNewSubTopic: () => {},
    onMove: () => {},
    onDeleteTopic: () => {},
  },
}

/** All row states side by side. */
export const AllStates: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-1 w-72">
      <PersonRow name="Alice Johnson" type="DM" />
      <PersonRow name="Amie Miles" type="DM" isUnread />
      <PersonRow name="Daniel Stanton" type="DM" isUnread isUrgent />
      <PersonRow name="Greg Bothman" type="DM" isSelected />
      <PersonRow name="CI/CD pipeline stuck during build stage" type="topic" />
      <PersonRow name="Remote work policy clarifications" type="topic" topicStatus="resolved" />
      <PersonRow name="Design crit" type="group" memberCount={4} />
      <PersonRow name="Roadmap review" type="huddle" />
      <PersonRow name="Account Management" type="team" />
      <PersonRow name="My mentions" type="view" />
    </div>
  ),
}
