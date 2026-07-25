import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect } from 'react'
import { addons } from 'storybook/preview-api'
import { GLOBALS_UPDATED } from 'storybook/internal/core-events'
import { themes } from 'storybook/theming'
import '../src/index.css'
import './preview.css'
import './signal.css'

const applyTheme = (theme?: string) => {
  // "signal" is a dark-based theme: keep .dark active so dark: variants apply,
  // then .signal's variables (loaded after index.css) override the palette.
  document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'signal')
  document.documentElement.classList.toggle('signal', theme === 'signal')
  document.body.classList.add('bg-bg-base', 'text-text-primary', 'font-sans')
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
        items: ['light', 'dark', 'signal'],
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
