import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConversationHeader } from './ConversationHeader'

const members = ['Alice Johnson', 'Jake Walter', 'Zack Bright', 'Amie Miles']

const meta = {
  title: 'Messages/ConversationHeader',
  component: ConversationHeader,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <div className="w-[860px] max-w-full bg-bg-surface">
        <Story />
      </div>
    ),
  ],
  args: {
    onToggleStarred: () => {},
  },
} satisfies Meta<typeof ConversationHeader>

export default meta
type Story = StoryObj<typeof meta>

/** Topic header: status icon + title, open/resolved counts, members pill, start-huddle, star, more.
 *  Clicking the members pill opens the MembersDialog (wired by the topic view). */
export const Topic: Story = {
  args: {
    name: 'Feedback on mobile onboarding flow',
    topicMode: true,
    openCount: 6,
    resolvedCount: 0,
    members,
    onStartHuddle: () => {},
    onShowMembers: () => {},
    /*
     * The header's more-menu, with everything a topic offers. It is the same
     * `TopicMoreMenu` the sidebar row uses — press the ⋮ to see it (PEE-2).
     * These were missing here, so the story showed the old one-item menu while
     * the app had the new one.
     */
    onOpenDetails: () => {},
    onDeleteTopic: () => {},
    openWorkAction: 'add',
    onToggleOpenWork: () => {},
  },
}

/** Fully-resolved topic — icon + counts go green. */
export const TopicResolved: Story = {
  args: {
    name: 'Remote work policy clarifications',
    topicMode: true,
    isResolved: true,
    openCount: 0,
    resolvedCount: 4,
    members,
    onStartHuddle: () => {},
  },
}

/** DM header: sender avatar + name, star + more (no counts or members pill). */
export const Dm: Story = {
  args: {
    name: 'Amie Miles',
  },
}

/** Starred DM — the star fills amber. */
export const DmStarred: Story = {
  args: {
    name: 'Amie Miles',
    isStarred: true,
  },
}

/** Huddle header (V2 main view): lock icon + member names + members pill. */
export const Huddle: Story = {
  args: {
    name: 'Greg Bothman, Alice Johnson',
    huddleMode: true,
    members: ['You', 'Greg Bothman', 'Alice Johnson'],
  },
}

// ── The Folder actions (PEE-3) ─────────────────────────────────────────────
//
// Two separate buttons, gated on two different things, which is why a topic
// could show one and not the other: "Copy Folder link" needs only a `folderId`,
// while the panel toggle needs the *page* to have offered a handler for it.
// Desk supplied the first and not the second, so a topic opened from there
// looked like it had no linked project.

/** A topic with a Folder, and a page that offers the panel — both buttons. */
export const TopicWithFolderPanel: Story = {
  args: {
    ...Topic.args,
    folderId: 'b1d2c3e4-5f60-4718-a93a-4b5c6d7e8f90',
    onToggleFolderPanel: () => {},
    folderPanelOpen: true,
  },
}

/** Panel hidden — same button, opposite tooltip and label. */
export const TopicFolderPanelClosed: Story = {
  args: { ...TopicWithFolderPanel.args, folderPanelOpen: false },
}

/**
 * **What Desk used to look like.** The Folder exists, so the copy-link button
 * renders, but no handler was passed so the panel toggle is absent — the topic
 * appears to have no project.
 */
export const TopicFolderWithoutPanelToggle: Story = {
  args: {
    ...Topic.args,
    folderId: 'b1d2c3e4-5f60-4718-a93a-4b5c6d7e8f90',
  },
}

/** No Folder at all: neither button, which is correct — there is nothing to link to. */
export const TopicWithoutFolder: Story = {
  args: { ...Topic.args },
}
