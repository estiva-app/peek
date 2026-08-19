import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect } from 'react'
import { addons } from 'storybook/preview-api'
import { GLOBALS_UPDATED } from 'storybook/internal/core-events'
import { themes } from 'storybook/theming'
import '../src/index.css'
import './preview.css'
import './signal.css'

/**
 * The themes this library renders.
 *
 * - `signal` — what Peek actually ships, and the only theme the app has.
 * - `dark` — Signal's base, kept selectable because Signal only overrides part
 *   of it and the difference is worth being able to see.
 * - `estiva-id` — the Estiva ID account screens. Neither class is applied, so
 *   the `:root` palette in index.css takes over: **light colours, with the
 *   typography, spacing and radius tokens unchanged**, since those are not
 *   theme-scoped. That is the whole point — one token system, a different
 *   palette per app, which is what unifying these designs has to mean.
 *
 * `light` is deliberately not offered. The palette is still in index.css and is
 * exactly what `estiva-id` renders; it is just not a theme Peek has any more.
 * To bring it back, add 'light' to the toolbar items below.
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

// Drive the theme class from the toolbar for EVERY page — including standalone
// MDX docs (Introduction, Design Tokens), which don't run story decorators.
try {
  addons.getChannel().on(GLOBALS_UPDATED, ({ globals }: { globals: { theme?: string } }) => {
    applyTheme(globals?.theme)
  })
} catch {
  /* channel not ready at import — the decorator still covers story pages */
}

// Apply the default (signal) immediately so standalone MDX pages — Introduction,
// Design Tokens — render themed on first load, before any GLOBALS_UPDATED fires.
applyTheme('signal')

const withTheme: Decorator = (Story, context) => {
  // parameters.forceTheme lets theme-specific stories (e.g. the Signal
  // specimens page) pin their theme regardless of the toolbar.
  const theme = (context.parameters.forceTheme as string) ?? context.globals.theme ?? 'signal'
  useEffect(() => {
    applyTheme(theme)
  }, [theme])
  return <Story />
}

const preview: Preview = {
  // Every component gets a Docs tab from its JSDoc + argTypes (D4: global autodocs).
  tags: ['autodocs'],
  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        // 'light' removed with Peek's theme picker — `estiva-id` renders that
        // same palette. Re-add it here if a light Peek is ever wanted again.
        items: ['signal', 'dark', 'estiva-id'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'signal' },
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    // Docs pages render in the dark chrome; the example blocks take the
    // app's dark canvas via .dark .docs-story in preview.css.
    docs: { theme: themes.dark },
    options: {
      // Docs first, then the domain-primary taxonomy (W6).
      storySort: {
        order: [
          'Docs',
          ['Introduction', 'Design Tokens'],
          'Flows',
          'Layouts',
          'Auth',
          'Primitives',
          'Feedback',
          'Inputs',
          'Messages',
          ['*', 'Composer', 'Menus'],
          'Topics',
          'Huddles',
          'Screener & Desk',
          'Navigation',
        ],
      },
    },
  },
  decorators: [withTheme],
}

export default preview
