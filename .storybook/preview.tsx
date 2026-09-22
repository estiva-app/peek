import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect } from 'react'
import { themes } from 'storybook/theming'
import { PeekDataProvider } from '../src/api'
import { DebugProvider } from '../src/lib/debug'
import { TopicStoreProvider } from '../src/api/internal/topicStore'
import '../src/index.css'
import './preview.css'
import './signal.css'

/**
 * The themes this Storybook renders — and there is no picker for them
 * (Katerina, 2026-09-11, D58).
 *
 * - `signal` — what Peek actually ships, and the only theme the app has. Every
 *   Peek story gets it, because a Peek story cannot honestly be anything else.
 * - `estiva-id` — the Estiva ID account screens, whose stories are loaded from
 *   that repo and pin themselves with `parameters.forceTheme` (their
 *   `estivaIdParameters`). Neither class is applied, so the `:root` palette in
 *   index.css takes over: **light colours, with the typography, spacing and
 *   radius tokens unchanged**, since those are not theme-scoped.
 *
 * A toolbar offered `signal` / `dark` / `estiva-id` until 2026-09-11. It was a
 * choice the app cannot make: Peek ships one theme and cannot switch at
 * runtime, so a Peek component seen in `dark` was a component in a state
 * nobody can reach. Checking a *shared* component across themes is estiva-ui's
 * Storybook's job, and it has the picker. `applyTheme` stays — `forceTheme`
 * drives it, and estiva-id's screens depend on that.
 */
const applyTheme = (theme?: string) => {
  // "signal" is a dark-based theme: keep .dark active so dark: variants apply,
  // then .signal's variables (loaded after index.css) override the palette.
  document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'signal')
  document.documentElement.classList.toggle('signal', theme === 'signal')
  // Marks the Estiva ID surface for the story harness in the estiva-id repo,
  // which scopes that app's own stylesheet to its own stories.
  const estivaId = theme === 'estiva-id'
  document.documentElement.classList.toggle('estiva-id', estivaId)

  /**
   * Peek's body classes are Peek's, and `.font-sans` is the one that bites.
   *
   * Estiva ID sets its font on `body` as an element selector, so a class here
   * outranks it and every account screen silently rendered in Geist instead of
   * the system stack it actually ships. Same for the colours. Under the Estiva
   * ID theme the app's own stylesheet is left to do its job — which is the
   * point of designing these screens here at all.
   */
  document.body.classList.toggle('bg-bg-base', !estivaId)
  document.body.classList.toggle('text-text-primary', !estivaId)
  document.body.classList.toggle('font-sans', !estivaId)
}

// Apply signal once, for EVERY page — including standalone MDX docs
// (Introduction), which don't run story decorators. The toolbar
// listener that used to sit here went with the picker: nothing changes the
// theme global any more, so there is nothing to follow.
applyTheme('signal')

const withTheme: Decorator = (Story, context) => {
  // parameters.forceTheme is now the only way a story asks for another theme:
  // the Signal specimens page, and every Estiva ID screen.
  const theme = (context.parameters.forceTheme as string) ?? 'signal'
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  return <Story />
}

/**
 * Every story runs inside the app's ambient providers. Components deep in a
 * tree reach for useDebug and the topic store — the read-state sync mounts
 * with the app since peek#97 — and a story rendering them without these
 * crashed to Storybook's error page. 67 of 316 stories were error pages
 * before this, silently, until a pixel run compared them (2026-09-01).
 *
 * PeekDataProvider is safe here because Storybook pins VITE_CONVEX_URL to ''
 * (main.ts): the dummy client only answers the context lookup — every query
 * in mock mode passes 'skip', but Convex's useQuery demands the provider
 * even then, which is what took NavRail down. Same nesting as main.tsx.
 */
const withProviders: Decorator = (Story) => (
  <DebugProvider>
    <PeekDataProvider>
      <TopicStoreProvider>
        <Story />
      </TopicStoreProvider>
    </PeekDataProvider>
  </DebugProvider>
)

const preview: Preview = {
  // Every component gets a Docs tab from its JSDoc + argTypes (D4: global autodocs).
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    // Docs pages render in the dark chrome; the example blocks take the
    // app's dark canvas via .dark .docs-story in preview.css.
    docs: { theme: themes.dark },
    options: {
      // Docs first, then the domain-primary taxonomy (W6).
      storySort: {
        /*
          Every heading is named, so none of them falls to the bottom in
          whatever order the indexer found it (Katerina, 20 September). Three
          names here had outlived their stories — Auth, Feedback and Inputs.
          Estiva ID is last and closed, because this Storybook is opened to look
          at Peek; see `manager.ts`.
        */
        order: [
          'Docs',
          ['Introduction'],
          'Primitives',
          'Messages',
          ['*', 'Composer'],
          'Topics',
          'Huddles',
          'Screener & Desk',
          'Navigation',
          'Overlays',
          'Views',
          'Entry',
          /* Parked, so a story that is going is visible instead of vanishing in
             someone else's pull request (Katerina, 22 September). Nothing goes in
             without a ticket number and the date it went in. */
          'To be removed',
          'Estiva ID',
        ],
      },
    },
  },
  decorators: [withProviders, withTheme],
}

export default preview
