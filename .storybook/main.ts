import type { StorybookConfig } from '@storybook/react-vite'
import remarkGfm from 'remark-gfm'

/**
 * Peek's own stories only. Estiva ID's used to be loaded from the sibling
 * checkout here; since 2026-09-23 they run in estiva-id's own Storybook
 * (`pnpm storybook`, :6009 — UIG-36), and nothing here reaches outside Peek.
 */
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: [
    /*
      Usage pages sit beside the component they describe, not in one central
      folder, so the rule travels with the code and is found by whoever opens
      the file (UIG-17). `src/stories/**` used to be the only place read, which
      is why a page next to a component silently never appeared.
    */
    '../src/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    {
      /*
        remark-gfm: MDX alone has no pipe tables. Peek had none of this, so
        every table in every `.mdx` rendered as a run of literal pipes —
        seventeen pages of fifty, including the Introduction's map of the
        sidebar and the register of what is parked (Katerina, 23 September).
        The package has carried this since its own docs pages needed it; Peek
        simply never did.
      */
      name: '@storybook/addon-docs',
      options: { mdxPluginOptions: { mdxCompileOptions: { remarkPlugins: [remarkGfm] } } },
    },
  ],
  viteFinal: (viteConfig) => {
    // Stories must be deterministic: blank out the Convex deployment URL so
    // the data seam takes its static-mock path (hasConvex = false) instead of
    // subscribing to live queries that never resolve without an authed
    // session (which left the page stories on permanent skeletons).
    // The relay is blanked for the same reason (REM-2): its absence is the
    // mock-mode flag for every relay path (`hasRelay`, src/api/relayUrl.ts).
    viteConfig.define = {
      ...viteConfig.define,
      'import.meta.env.VITE_CONVEX_URL': JSON.stringify(''),
      'import.meta.env.VITE_RELAY_URL': JSON.stringify(''),
    }

    return viteConfig
  },
}

export default config
