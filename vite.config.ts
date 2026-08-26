import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * @estiva/ui is a local link (file:../estiva-ui) consumed as SOURCE: Vite
 * resolves the link to its real path, which is outside this repo, so it has
 * to be allowed — and `react` must be deduped, or the package's own copy
 * would be a second React (the "invalid hook call" crash).
 */
const estivaUiRoot = path.resolve(__dirname, '../estiva-ui')

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
      allow: [__dirname, estivaUiRoot],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
})
