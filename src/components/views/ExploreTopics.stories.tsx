import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { ExploreRow, ExploreState, ExploreTab } from '@/api'
import { ExploreTopicsView } from './ExploreTopics'

/**
 * Explore topics (TOPI-6): every topic you can read, archived ones too, with a
 * search and Join, as the approved prototype draws it (peek
 * `concept/topics-level-up`, *Peek: Explore topics*).
 */
const SHIP = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const NOW = Date.UTC(2026, 10, 10, 12)
const HOUR = 3600

const row = (d: string, title: string, extra: Partial<ExploreRow>): ExploreRow => ({
  topic: { address: `30840:${SHIP}:${d}`, slots: { title: { value: title } } } as unknown as ForeignObject,
  address: `30840:${SHIP}:${d}`,
  title,
  href: '#',
  archived: false,
  yours: false,
  ...extra,
})
const at = (hoursAgo: number) => NOW / 1000 - hoursAgo * HOUR

const widgets = row('widgets', 'Widgets', { yours: true, team: 'Product', members: 4, active: at(0.2), summary: 'The widget catalogue and its roadmap' })
const release = row('release', 'Release notes', { yours: true, team: 'Company', members: 6, active: at(5) })
const speed = row('speed', 'Speed', { yours: true, team: 'Product', members: 3, active: at(30) })
const onboarding = row('onboarding', 'Onboarding', { team: 'People', members: 5, active: at(50) })
const hiring = row('hiring', 'Hiring', { team: 'People', members: 2, active: at(24 * 9) })
const pricing = row('pricing', 'Pricing', { team: 'Sales' })
const domain = row('domain', 'Domain name - brainstorming', { archived: true, team: 'Company', members: 3, active: at(24 * 60) })
const level2 = row('level-2', 'Level 2', { archived: true, team: 'Product', members: 2, active: at(24 * 120) })

const byTitle = (a: ExploreRow, b: ExploreRow) => a.title.localeCompare(b.title)
const LISTS: ExploreState = {
  all: [widgets, release, speed, onboarding, hiring, pricing].sort(byTitle),
  yours: [widgets, release, speed],
  others: [onboarding, hiring, pricing].sort(byTitle),
  archived: [domain, level2],
}

function Explore({ state, start = 'yours' }: { state: ExploreState; start?: ExploreTab }) {
  const [tab, setTab] = useState<ExploreTab>(start)
  return <ExploreTopicsView state={state} tab={tab} onTab={setTab} onRetry={() => {}} onJoin={() => {}} now={NOW} />
}

const meta = {
  title: 'Folders/ExploreTopics',
  component: Explore,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="flex h-[640px] w-[880px]">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof Explore>
export default meta
type Story = StoryObj<typeof meta>

/** Opens on Your topics, in the column's order; Pricing's Members and Active are still being read. */
export const YourTopics: Story = { args: { state: LISTS } }

/** Other topics, A to Z, each with Join. */
export const OtherTopics: Story = { args: { state: LISTS, start: 'others' } }

/** Archived, A to Z: each opens read-only, with no Join. */
export const Archived: Story = { args: { state: LISTS, start: 'archived' } }

export const Loading: Story = { args: { state: 'loading' } }

export const Failed: Story = { args: { state: { failed: true } } }
