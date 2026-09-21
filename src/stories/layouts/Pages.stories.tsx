import type { Meta, StoryObj } from '@storybook/react-vite'
import { PeekApp } from '../PeekApp'

/**
 * Full-page compositions of the real app (populated with seed data), each
 * deep-linked to a route via the `PeekApp` harness. These are live — navigate
 * the nav rail, open conversations, switch tabs. (Empty / first-login states
 * arrive with the Convex data layer, which owns the "empty workspace" switch.)
 */
const meta = {
  title: 'Layouts/App',
  component: PeekApp,
  parameters: {
    layout: 'fullscreen',
    // The whole app (h-screen) — iframe it on the Docs page so it doesn't
    // blow out the docs layout.
    docs: { story: { inline: false, height: '720px' } },
  },
  argTypes: { route: { control: false } },
} satisfies Meta<typeof PeekApp>

export default meta
type Story = StoryObj<typeof meta>

/** Desk — the triage home: Screener, Urgent, Open work, Starred. */
export const Desk: Story = { args: { route: '/app/desk' } }

/** Topics — the topic list + conversation area. */
export const Topics: Story = { args: { route: '/topics' } }

/** People — DMs, teams, and agents in the left panel. */
export const People: Story = { args: { route: '/app/people' } }
