import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

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
export default defineConfig({
  plugins: [react()],
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
