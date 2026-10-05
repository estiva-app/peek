/**
 * App smoke test — mounts the real page tree with the real provider stack
 * (same composition as main.tsx, minus Analytics) and verifies each page
 * renders its data through the src/api seam. Guards the seam wiring:
 * a broken provider or merge regression fails here before anyone opens
 * the app.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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
    </MemoryRouter>,
  )
}

const currentUrl = () => screen.getByTestId('location').textContent

describe('app smoke (seam wiring)', () => {
  // Text queries use getAllByText — labels legitimately repeat across the
  // nav rail, headers, list rows, and cards.
  const present = (matcher: string | RegExp) => screen.getAllByText(matcher).length

  it('renders the Desk page sections from the seam', () => {
    renderApp('/app/desk')
    expect(present('Desk')).toBeGreaterThan(0)
    expect(present('Open work')).toBeGreaterThan(0)
    expect(present('Starred')).toBeGreaterThan(0)
    // A Screener DM, an Urgent DM and a starred DM — every row is a person's
    // or a file's since the Convex topics went (FOL-23).
    expect(present('Amie Miles')).toBeGreaterThan(0)
    expect(present('Daniel Stanton')).toBeGreaterThan(0)
    expect(present('Greg Bothman')).toBeGreaterThan(0)
  })

  /**
   * FOL-26's done-when 1, through the real router: every old topic URL shape
   * lands on the file its conversation moved to, and none of them renders the
   * retired Topics view. The ids and uuids are production's, from
   * `legacyTopicLinks`; nothing here is resolved through Convex.
   *
   * A bare file's word is Peek's own, so it lands at its short form at once.
   * No Ship manifest is readable here, so a project is written in its long
   * form, `/topic/<address>` — `FilePage` shortens it once it resolves.
   */
  describe('old topic links land on files (FOL-26)', () => {
    const CHANNEL = 'e83471a7-cd98-4a62-ac5a-f21e0daedd24'
    const FILE = '/topic/folders-universal-navigation-concept-620929ad-2985-479b-a4b3-5d5d9cae9705'
    const PROJECT = '/topic/30850:a8a7d739dda599143ec2e88a1c3b2d69808cd2a50001179c786f51d00dc3c697:2a5b8f13-0364-4a84-bdd4-fc0a6ddc259c'

    it.each([
      ['/topics/<seedKey>', '/topics/t_1787038103126_1', FILE],
      ['/topic-old/<slug>-<uuid>', `/topic-old/folders-universal-navigation-concept-${CHANNEL}`, FILE],
      ['/topic-old/ with a stale slug', `/topic-old/whatever-it-used-to-be-${CHANNEL}?huddle=h1`, FILE],
      ['/topic-old/<uuid>', `/topic-old/${CHANNEL}`, FILE],
      ['the pre-FOL-37 /topic/<slug>-<uuid>', `/topic/folders-${CHANNEL}`, FILE],
      ['a topic whose conversation is a Ship project', '/topic-old/feedback-on-peek-2303e8c1-c866-43b8-9b4c-e263f313a683', PROJECT],
      ['For testing, discarded, to its team', '/topics/t_1788464201556_1', '/app/folders/fd03975a-eb00-49d6-a4b7-33ead1854672'],
      ['/topics, the directory, to the Folder tree', '/topics', '/app/folders'],
    ])('%s', (_label, from, to) => {
      renderApp(from)
      expect(currentUrl()).toBe(to)
    })

    it('never draws the Topics view, even for a mock topic', () => {
      renderApp('/topics/3')
      expect(screen.queryByText('Ongoing onboarding issues')).toBeNull()
      expect(screen.queryByText(/Funnel data is in/)).toBeNull()
      expect(present(/does not point at anything Peek can open/)).toBeGreaterThan(0)
    })

    /** A short link whose uuid is no topic's is a file's, and stays on the file
     *  page: nothing here can resolve it, and it must not fall through to the
     *  topics page and land on "some" topic. */
    it('keeps a /topic/<slug>-<d> that is no topic on the file page', () => {
      renderApp('/topic/some-file-00000000-0000-4000-8000-000000000000')
      expect(currentUrl()).toBe('/topic/some-file-00000000-0000-4000-8000-000000000000')
      expect(screen.queryByText(/doesn't lead to a topic you can open/)).toBeNull()
    })
  })

  /*
    The root belongs to files and Peek's own pages live under `/app/` — FOL-39,
    RFC 0.5 §7.7. What is pinned here is the router: the words themselves come
    off the manifests at runtime and are `FilePage.test.tsx`'s.
  */
  describe('the root is files; Peek’s pages are under /app/', () => {
    it.each([
      ['/', '/app/desk'],
      ['/desk', '/app/desk'],
      ['/app', '/app/desk'],
      ['/folders', '/app/folders'],
      // Any Folder that was not one of the old topics: those lead on to their file (FOL-23).
      ['/folders/5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a', '/app/folders/5d4c3b2a-1f0e-4d9c-8b7a-6e5f4d3c2b1a'],
      ['/people', '/app/people'],
      ['/people/alice?x=1', '/app/people/alice?x=1'],
    ])('%s lands on %s', (from, to) => {
      renderApp(from)
      expect(currentUrl()).toBe(to)
    })

    it('opens /<word>/<slug>-<d> on the file page for a word another app declared', () => {
      // No manifest is readable here, so nothing resolves — but the route is
      // the file page's, not a 404 and not the topics page.
      renderApp('/issue/fix-the-header-00000000-0000-4000-8000-000000000000')
      expect(currentUrl()).toBe('/issue/fix-the-header-00000000-0000-4000-8000-000000000000')
      expect(screen.queryByText(/doesn't lead to a topic you can open/)).toBeNull()
      expect(screen.queryByText(/does not point at anything Peek can open/)).toBeNull()
    })

    it('keeps /topic-old/ at the root, as a redirect', () => {
      renderApp('/topic-old/00000000-0000-4000-8000-000000000000')
      expect(currentUrl()).toBe('/app/folders/00000000-0000-4000-8000-000000000000')
    })
  })

  it('renders a DM with its partner in the header', () => {
    renderApp('/app/people/alice')  // DMs are keyed by the partner's person key (§2.4)
    expect(present('Alice Johnson')).toBeGreaterThan(0)
    // The conversation itself is the relay's since REM-1 — there is no mock
    // copy of it to render, and `useFileConversation.test.tsx` pins the read.
  })
})
