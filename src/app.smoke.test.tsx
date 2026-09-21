/**
 * App smoke test — mounts the real page tree with the real provider stack
 * (same composition as main.tsx, minus Analytics) and verifies each page
 * renders its data through the src/api seam. Guards the seam wiring:
 * a broken provider or merge regression fails here before anyone opens
 * the app.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { ThemeProvider } from '@/lib/theme'
import { DebugProvider } from '@/lib/debug'
import { PeekDataProvider } from '@/api'
import { LastSelectionProvider } from '@/lib/lastSelection'
import { ToastProvider } from '@/lib/toast'
import App from './App'

/** Reports the router's current URL, so a redirect can be asserted on. */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>
}

function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>
        <DebugProvider>
          <PeekDataProvider>
            <LastSelectionProvider>
              <ToastProvider>
                <App />
                <LocationProbe />
              </ToastProvider>
            </LastSelectionProvider>
          </PeekDataProvider>
        </DebugProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const currentUrl = () => screen.getByTestId('location').textContent

describe('app smoke (seam wiring)', () => {
  // Text queries use getAllByText — labels legitimately repeat across the
  // nav rail, headers, list rows, and cards.
  const present = (matcher: string | RegExp) => screen.getAllByText(matcher).length

  it('renders the Desk page sections from the seam', () => {
    renderApp('/desk')
    expect(present('Desk')).toBeGreaterThan(0)
    expect(present('Open work')).toBeGreaterThan(0)
    expect(present('Starred')).toBeGreaterThan(0)
    // Screener item (seeded) + Open work topics + a starred DM
    expect(present('Updates on the new office layout')).toBeGreaterThan(0)
    expect(present('Launch checklist for v2 of the mobile app')).toBeGreaterThan(0)
    expect(present('Greg Bothman')).toBeGreaterThan(0)
  })

  it('renders a topic conversation and opens its thread panel', () => {
    renderApp('/topics/3')
    // Topic list + selected topic's messages (merged through useTopicMessages)
    expect(present('Ongoing onboarding issues')).toBeGreaterThan(0)
    const message = screen.getAllByText(/Funnel data is in/)[0]
    // Open the thread panel (global useThread lookup)
    fireEvent.click(message)
    expect(present('Replies')).toBeGreaterThan(0)
    expect(present(/41% drop-off is worse than I expected/)).toBeGreaterThan(0)
  })

  /**
   * PEE-21's done-when: a container past the reaction horizon says how many
   * messages were not checked, once, and one under it says nothing. The number
   * rides on the topic (`reactionTargetsOmitted`, recorded by the sync and
   * carried by `topics.list`); this proves the view actually draws it.
   */
  it('says how many messages were past the reaction horizon', () => {
    renderApp('/topics/7')
    expect(present(/14 older ones were not checked/)).toBe(1)
  })

  it('says nothing about the horizon under the cap', () => {
    renderApp('/topics/3')
    expect(screen.queryByText(/were not checked/)).toBeNull()
  })

  /**
   * PEE-14's done-when, exercised the way it is actually used: a cold load of a
   * pasted URL in a fresh tab, through the real router and the real provider
   * stack. Nothing here is carried over from a previous navigation — no
   * remembered selection, no in-memory router history — which is the case a
   * path-based object URL breaks first.
   *
   * The topic is mock '7', the one fixture with a channel uuid.
   */
  describe('object URLs (PEE-14)', () => {
    const UUID = 'b7c1e0a4-2f3d-4a86-9c15-8d0e6f2a4b91'
    const CANONICAL = `/topic-old/updates-on-the-new-office-layout-${UUID}`

    it('cold-loads a topic from its canonical URL', () => {
      renderApp(CANONICAL)
      expect(present('Updates on the new office layout')).toBeGreaterThan(0)
      expect(currentUrl()).toBe(CANONICAL)
    })

    /** §7.2: a consumer MUST ignore everything before the final uuid — which is
     *  what keeps a link working after the topic has been renamed. */
    it('resolves a link whose slug is stale, and refreshes the slug', () => {
      renderApp(`/topic-old/whatever-this-used-to-be-called-${UUID}`)
      expect(present('Updates on the new office layout')).toBeGreaterThan(0)
      expect(currentUrl()).toBe(CANONICAL)
    })

    it('resolves a bare uuid with no slug at all', () => {
      renderApp(`/topic-old/${UUID}`)
      expect(present('Updates on the new office layout')).toBeGreaterThan(0)
      expect(currentUrl()).toBe(CANONICAL)
    })

    /** Old links are already in the wild and in every browser history; they keep
     *  working, and they upgrade in place the first time they are opened. */
    it('upgrades a legacy /topics/<peek-id> link to the canonical URL', () => {
      renderApp('/topics/7')
      expect(present('Updates on the new office layout')).toBeGreaterThan(0)
      expect(currentUrl()).toBe(CANONICAL)
    })

    /** A topic with no channel uuid has no protocol identity to put in a URL.
     *  The legacy path still works and is left alone rather than faked. */
    it('leaves a topic that has no channel uuid on the legacy path', () => {
      renderApp('/topics/3')
      expect(present('Ongoing onboarding issues')).toBeGreaterThan(0)
      expect(currentUrl()).toBe('/topics/3')
    })

    it('carries an open huddle through the canonical URL', () => {
      renderApp(`${CANONICAL}?huddle=h1`)
      expect(currentUrl()).toBe(`${CANONICAL}?huddle=h1`)
    })

    /** The short form was the Convex topic's until FOL-37 and is in the wild;
     *  a link that names a channel uuid there opens the topic at its new prefix,
     *  and carries its query along. */
    it('sends an old /topic/<slug>-<channel-uuid> link to /topic-old/', () => {
      renderApp(`/topic/whatever-this-used-to-be-called-${UUID}?huddle=h1`)
      expect(present('Updates on the new office layout')).toBeGreaterThan(0)
      expect(currentUrl()).toBe(`${CANONICAL}?huddle=h1`)
    })

    /** A short link whose uuid is no topic's is a file's, and stays on the file
     *  page: nothing here can resolve it, and it must not fall through to the
     *  topics page and land on "some" topic. */
    it('keeps a /topic/<slug>-<d> that is no topic on the file page', () => {
      renderApp('/topic/some-file-00000000-0000-4000-8000-000000000000')
      expect(currentUrl()).toBe('/topic/some-file-00000000-0000-4000-8000-000000000000')
      expect(screen.queryByText(/doesn't lead to a topic you can open/)).toBeNull()
    })

    /** A link that resolves to nothing says so, rather than quietly showing a
     *  different conversation — which would leave somebody believing they were
     *  reading what the link pointed to. */
    it('says so when a link resolves to no topic', () => {
      renderApp('/topic-old/deleted-topic-00000000-0000-4000-8000-000000000000')
      expect(present(/doesn't lead to a topic you can open/)).toBeGreaterThan(0)
    })
  })

  it('renders a DM conversation with merged reply counts', () => {
    renderApp('/people/alice')  // DMs are keyed by the partner's person key (§2.4)
    expect(present('Alice Johnson')).toBeGreaterThan(0)
    // Token-free line (reference chips like #48821 split text nodes)
    expect(present(/EU completions dropped 28% in 5 days/)).toBeGreaterThan(0)
    // dm1_c5 has 3 static replies — the thread panel shows them merged
    const message = screen.getAllByText(/current export design assumes synchronous generation/)[0]
    fireEvent.click(message)
    expect(present('Replies')).toBeGreaterThan(0)
    expect(present(/job queue approach makes more sense/)).toBeGreaterThan(0)
  })
})
