import type { Decorator, Preview } from '@storybook/react-vite'
import { themes } from 'storybook/theming'
import { PeekDataProvider } from '../src/api'
import { DebugProvider } from '../src/lib/debug'
import { TopicStoreProvider } from '../src/api/internal/topicStore'
import '../src/index.css'
import './preview.css'
import './signal.css'

/**
 * The one theme this Storybook renders, with no picker for it (Katerina,
 * 2026-09-11, D58). `signal` is what Peek ships and the only theme the app
 * has, so a Peek story cannot honestly be anything else; checking a *shared*
 * component across themes is estiva-ui's Storybook's job, and it has the picker.
 *
 * Applied once, here, so it reaches every page — standalone MDX docs such as
 * the Introduction run no story decorators. Until 2026-09-23 a story could ask
 * for another theme through `parameters.forceTheme`; only Estiva ID's screens
 * did, and they now run in estiva-id's own Storybook (UIG-36).
 */
// "signal" is a dark-based theme: keep .dark active so dark: variants apply,
// then .signal's variables (loaded after index.css) override the palette.
document.documentElement.classList.add('dark', 'signal')
document.body.classList.add('bg-bg-base', 'text-text-primary', 'font-sans')

/**
 * Every story runs inside the app's ambient providers. Components deep in a
 * tree reach for useDebug and the topic store — the read-state sync mounts
 * with the app since peek#97 — and a story rendering them without these
 * crashed to Storybook's error page. 67 of 316 stories were error pages
 * before this, silently, until a pixel run compared them (2026-09-01).
 *
 * PeekDataProvider is safe here because Storybook pins VITE_RELAY_URL to ''
 * (main.ts), so every store in it answers from the mock data. Same nesting as
 * main.tsx.
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
      /*
        Headings in a written order; everything inside them alphabetical;
        the stories inside one component left exactly as its file writes them
        (Katerina, 23 September).

        Why this is a function and not `method: 'alphabetical'`: that setting
        sorts every level, including the stories within a component, and those
        are ordered on purpose — a card's default before its fifteen states.
        Returning 0 for two entries of the same title is what leaves them
        alone.

        A heading not named here sorts after the named ones rather than
        wherever the indexer happened to find it.
      */
      storySort: (a, b) => {
        const HEADINGS = [
          'Docs',
          /* The pages themselves first, before the parts they are built from. */
          'Pages',
          /* Everything that wraps a screen: the shell, the rail, the header,
             the replies column, the signed-out shell (Katerina, 23 September —
             `Navigation` and `Entry` were the same idea under two names). */
          'Frame',
          'Primitives',
          'Messages',
          /* Carved out of Messages: the body, what renders it, and the
             composer that writes it. */
          'Writing & text',
          'Topics',
          /* The seven file and folder parts that had been split across
             Messages, Navigation and Overlays (Katerina, 23 September). */
          'Folders',
          'Screener & Desk',
          'Overlays',
          /* Parked, so a story that is going is visible instead of vanishing in
             someone else's pull request (Katerina, 22 September). Nothing goes
             in without a ticket number and the date it went in. */
          'To be removed',
        ]
        const left = a.title.split('/')
        const right = b.title.split('/')
        const rank = (name) => {
          const at = HEADINGS.indexOf(name)
          return at === -1 ? HEADINGS.length : at
        }
        /*
          Two headings that are both unnamed ranked equal, so the sort left
          them tied and their entries interleaved rather than grouping
          (estiva-04, 23 September). Unnamed headings sort after the named ones
          and alphabetically among themselves.
        */
        if (left[0] !== right[0]) {
          const byRank = rank(left[0]) - rank(right[0])
          return byRank !== 0 ? byRank : left[0].localeCompare(right[0], 'en')
        }
        for (let depth = 1; depth < Math.max(left.length, right.length); depth++) {
          if (left[depth] === undefined) return -1
          if (right[depth] === undefined) return 1
          if (left[depth] !== right[depth]) return left[depth].localeCompare(right[depth], 'en')
        }
        return 0
      },
    },
  },
  decorators: [withProviders],
}

export default preview
