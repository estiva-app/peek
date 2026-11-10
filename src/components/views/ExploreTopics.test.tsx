/**
 * Explore topics as a person sees it (TOPI-6): the four tabs with their counts,
 * a search by the start of a word, each row's team, members and last active,
 * Join only on a live topic you are not in, and the page's failed state.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ForeignObject } from '@estiva-app/interop'
import type { ExploreRow, ExploreState, ExploreTab } from '@/api'
import { openedFrom } from '@/lib/openedFrom'
import { ExploreTopics, ExploreTopicsView } from './ExploreTopics'

const hook = vi.hoisted(() => ({ tabs: [] as string[], state: 'loading' as unknown }))
vi.mock('@/api', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/api')),
  useExploreTopics: (tab: string) => {
    hook.tabs.push(tab)
    return { state: hook.state, retry: () => {} }
  },
}))

const PK = 'b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46'
const NOW = Date.UTC(2026, 10, 10, 12)
const row = (d: string, title: string, extra: Partial<ExploreRow> = {}): ExploreRow => ({
  topic: { address: `30840:${PK}:${d}`, slots: { title: { value: title } } } as unknown as ForeignObject,
  address: `30840:${PK}:${d}`,
  title,
  href: `/topic/${d}`,
  archived: false,
  yours: false,
  ...extra,
})
const WIDGETS = row('widgets', 'Widgets', { yours: true, team: 'Product', members: 3, active: NOW / 1000 - 2 * 3600 })
const Q4 = row('q4', 'Q4-plan review', { team: 'Sales', members: 7, active: NOW / 1000 - 86400 })
const PRICING = row('pricing', 'Pricing')
const OLD = row('old', 'Level 2', { archived: true, team: 'Product', members: 2 })
const LISTS: ExploreState = { all: [PRICING, Q4, WIDGETS], yours: [WIDGETS], others: [PRICING, Q4], archived: [OLD] }

function mount(state: ExploreState, tab: ExploreTab = 'all', handlers: { onJoin?: (topic: ForeignObject) => void; onRetry?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <ExploreTopicsView state={state} tab={tab} onTab={() => {}} onRetry={handlers.onRetry ?? (() => {})} onJoin={handlers.onJoin ?? (() => {})} now={NOW} />
    </MemoryRouter>,
  )
}
const shownTitles = () => [...document.querySelectorAll('[data-topic] a')].map((link) => link.textContent)
const rowOf = (title: string) => screen.getByText(title).closest('[data-topic]') as HTMLElement

describe('Explore topics (TOPI-6)', () => {
  it('opens on All, every live topic, not the Your topics the column already lists (Miky, 10 Nov)', () => {
    hook.state = LISTS
    render(
      <MemoryRouter>
        <ExploreTopics onControl={() => {}} />
      </MemoryRouter>,
    )
    expect(hook.tabs[0]).toBe('all')
    expect(shownTitles()).toEqual(['Pricing', 'Q4-plan review', 'Widgets'])
  })

  it('counts each tab', () => {
    mount(LISTS)
    for (const [label, count] of [['All', 3], ['Your topics', 1], ['Other topics', 2], ['Archived', 1]] as const) {
      expect(screen.getByRole('tab', { name: new RegExp(`${label}`) }).textContent).toContain(String(count))
    }
  })

  it('finds a topic by the start of any word of its title, and not by the middle of one', async () => {
    mount(LISTS)
    const search = screen.getByLabelText('Find a topic')
    await userEvent.type(search, 'pla')
    expect(shownTitles()).toEqual(['Q4-plan review'])
    await userEvent.clear(search)
    await userEvent.type(search, 'idgets')
    expect(shownTitles()).toEqual([])
    expect(screen.getByText('No topic matches “idgets”.')).toBeInTheDocument()
  })

  it('draws each row’s team, members and last active, and a dash for what is not read yet', () => {
    mount(LISTS)
    expect(within(rowOf('Widgets')).getByText('Product')).toBeInTheDocument()
    expect(within(rowOf('Widgets')).getByText('3')).toBeInTheDocument()
    expect(within(rowOf('Widgets')).getByText('2 hours ago')).toBeInTheDocument()
    expect(within(rowOf('Q4-plan review')).getByText('Yesterday')).toBeInTheDocument()
    expect(within(rowOf('Pricing')).getAllByText('–')).toHaveLength(3)
  })

  it('offers Join only on a topic you are not in, and Join joins that topic', async () => {
    const onJoin = vi.fn()
    mount(LISTS, 'all', { onJoin })
    expect(within(rowOf('Widgets')).queryByRole('button', { name: 'Join' })).toBeNull()
    await userEvent.click(within(rowOf('Pricing')).getByRole('button', { name: 'Join' }))
    expect(onJoin).toHaveBeenCalledWith(PRICING.topic)
  })

  it('an archived topic has no Join, is marked archived, and opens with the Topics column beside it', async () => {
    mount(LISTS, 'archived')
    const archived = rowOf('Level 2')
    expect(within(archived).queryByRole('button', { name: 'Join' })).toBeNull()
    expect(within(archived).getByLabelText('Archived')).toBeInTheDocument()
    const link = within(archived).getByRole('link')
    expect(link.getAttribute('href')).toBe('/topic/old')
    await userEvent.click(link)
    expect(openedFrom(OLD.address)).toBe('topics')
  })

  it('says so on an empty tab, in Ship’s and Leaf’s words', () => {
    mount({ all: [PRICING], yours: [], others: [PRICING], archived: [] }, 'yours')
    expect(screen.getByText('You’re in no topics yet.')).toBeInTheDocument()
  })

  it('asks a signed-out person to sign in, rather than loading for ever', () => {
    mount('signedOut')
    expect(screen.getByText('Sign in to see topics.')).toBeInTheDocument()
    expect(shownTitles()).toEqual([])
  })

  it('finds by the launcher’s rules: a minus word leaves out the topics that have it', async () => {
    mount(LISTS, 'all')
    await userEvent.type(screen.getByLabelText('Find a topic'), 'p -review')
    expect(shownTitles()).toEqual(['Pricing'])
  })

  it('says the topics did not load, and Try again asks again', async () => {
    const onRetry = vi.fn()
    mount({ failed: true }, 'yours', { onRetry })
    expect(screen.getByText('Topics didn’t load.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
