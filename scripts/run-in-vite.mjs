/**
 * Run a script through Vite's module graph, so it sees what the app sees.
 *
 *   node scripts/run-in-vite.mjs scripts/probe-foo.ts [args…]
 *
 * A probe that imports app code cannot run under bare `tsx`: `import.meta.env`
 * is Vite's, not Node's, and every module that reads a `VITE_*` variable throws
 * on load. Vite's own SSR loader gives the probe the `@/` alias, the env, and
 * the same resolution the browser build uses — which is the point, since a
 * probe that reaches the relay by a path the app does not take is how FOL-25
 * came to report a thread read as working while the page showed nothing.
 */
import { createServer } from 'vite'

const [target, ...rest] = process.argv.slice(2)
if (!target) {
  console.error('usage: node scripts/run-in-vite.mjs <script.ts> [args…]')
  process.exit(2)
}

// The probe reads its own argv; give it the shape it would have under tsx.
process.argv = [process.argv[0], target, ...rest]

const server = await createServer({
  configFile: './vite.config.ts',
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'warn',
})
try {
  const mod = await server.ssrLoadModule(target.startsWith('.') ? target : `./${target}`)
  if (typeof mod.default === 'function') await mod.default()
} finally {
  await server.close()
}
