import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorybookConfig } from '@storybook/react-vite'

const here = dirname(fileURLToPath(import.meta.url))
const peekRoot = resolve(here, '..')
/**
 * The other Estiva apps, as sibling checkouts.
 *
 * This is the one shared component library for the whole suite, so it loads
 * stories from the other repos rather than each app having a Storybook nobody
 * compares against. Sibling paths because that is the layout on disk
 * (`k:\Estiva\peek`, `k:\Estiva\estiva-id`, …); a missing checkout means those
 * stories are simply absent, not a broken build.
 */
const estivaIdRoot = resolve(peekRoot, '../estiva-id')

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: [
    '../src/stories/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx)',
    /*
      Estiva ID's stories, under one heading of their own (Katerina, 20
      September: its four headings sat mixed in among Peek's, and "Entry" held
      one story from each app). `titlePrefix` is prepended to the title a story
      declares, so this needs no change in the estiva-id repo.
    */
    {
      directory: `${estivaIdRoot}/web/src`,
      files: '**/*.stories.@(ts|tsx)',
      titlePrefix: 'Estiva ID',
    },
  ],
  addons: ['@storybook/addon-docs'],
  viteFinal: (viteConfig) => {
    // Stories must be deterministic: blank out the Convex deployment URL so
    // the data seam takes its static-mock path (hasConvex = false) instead of
    // subscribing to live queries that never resolve without an authed
    // session (which left the page stories on permanent skeletons).
    viteConfig.define = {
      ...viteConfig.define,
      'import.meta.env.VITE_CONVEX_URL': JSON.stringify(''),
    }

    /**
     * One React, for stories from more than one repo.
     *
     * A story in `estiva-id` resolves `react` from *its* `node_modules`, which
     * is a second copy of the library. Two Reacts in one page is the classic
     * "invalid hook call" — and it surfaces as a crash inside somebody's
     * component, which is the last place anyone looks. Pinning both to Peek's
     * copy is what makes the shared instance possible at all.
     */
    viteConfig.resolve = {
      ...viteConfig.resolve,
      dedupe: [...(viteConfig.resolve?.dedupe ?? []), 'react', 'react-dom'],
      alias: {
        ...viteConfig.resolve?.alias,
        react: resolve(peekRoot, 'node_modules/react'),
        'react-dom': resolve(peekRoot, 'node_modules/react-dom'),
      },
    }

    // Vite refuses to serve files outside its root, and every Estiva ID story
    // is outside it.
    viteConfig.server = {
      ...viteConfig.server,
      fs: {
        ...viteConfig.server?.fs,
        allow: [...(viteConfig.server?.fs?.allow ?? []), peekRoot, estivaIdRoot],
      },
    }

    return viteConfig
  },
}

export default config
