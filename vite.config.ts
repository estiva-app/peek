import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'node:child_process'

/**
 * `react` is deduped because @estiva-app/ui declares it a peer: two copies in
 * one tree is the "invalid hook call" crash, and it appears at runtime rather
 * than at build time.
 *
 * There is no `fs.allow` entry for the package any more — it installs from npm
 * into node_modules like anything else. It used to be a `file:` link to a
 * sibling directory, which resolved outside this repo and therefore existed on
 * exactly one machine.
 */
// https://vite.dev/config/
/**
 * The commit a bundle is built from, for its error reports (PROD-2): CI's
 * `GITHUB_SHA`, or this checkout's HEAD. Sentry names an error new or back by it.
 */
function release(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_PEEK_RELEASE': JSON.stringify(release()),
  },
  /**
   * Source maps are served beside the bundle so Sentry can turn a report's
   * frames into readable code (PROD-2). The repo is public, so they show
   * nothing new; a browser fetches one only when its devtools are open.
   */
  build: {
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    fs: {
      allow: [__dirname],
    },
  },
  /**
   * Two projects, split by extension (PER-14). Setting up jsdom was the largest
   * single cost in the suite, and a `.test.ts` file mostly has no DOM to test,
   * so it runs under node. A `.test.ts` file that does need the DOM says so with
   * a `// @vitest-environment jsdom` header.
   */
  test: {
    globals: true,
    setupFiles: './src/test-setup.ts',
    /**
     * A run on a box other sessions are testing on gets a fraction of a core
     * per worker: at load 20–60 the 5 s default failed up to 74 screen tests,
     * each passing alone. 30 s held at load 24–40 (2164b3d5). Locally a run
     * also takes 4 workers, not every core, so two sessions testing at once
     * do not starve each other; CI has its runner to itself.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: process.env.CI ? undefined : 4,
    projects: [
      {
        extends: true,
        test: { name: 'dom', environment: 'jsdom', include: ['**/*.test.tsx'] },
      },
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['**/*.test.ts'] },
      },
    ],
  },
})
