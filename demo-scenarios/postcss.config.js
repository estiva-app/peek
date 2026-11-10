import { fileURLToPath } from 'node:url'

// Explicit config path: `npx vite demo-scenarios` runs with cwd at the repo
// root, where the APP's tailwind.config.js lives — without this, Tailwind
// would scan the wrong tree and emit none of our classes.
export default {
  plugins: {
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
}
