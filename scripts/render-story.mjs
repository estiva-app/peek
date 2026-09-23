/**
 * Render a story from a static Storybook build and say what it measures.
 *
 * The verify skill, "Measure a story": a story that exists but was never
 * rendered is unreviewed, and
 * "it looks right" is not a result. This is the recipe that works here with
 * no Storybook dev server and no browser install — Chromium 1228 is already
 * in `~/.cache/ms-playwright/` and `playwright-core 1.61.1` matches it.
 *
 *   npx storybook build --quiet -o /tmp/peek-sb
 *   node scripts/render-story.mjs /tmp/peek-sb <story-id> [<story-id>…] \
 *     [--out /tmp/shots] [--wait '<css selector>'] [--measure '<css selector>']
 *
 * Story ids are the `id`s in `<build>/index.json`, e.g.
 * `messages-composer-filesmenu--default`. For each one it writes
 * `<out>/<id>.png` and prints the text content plus the computed box
 * (height, padding, radius, font) of every element matching `--measure`.
 */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  if (i === -1) return fallback
  const [value] = args.splice(i, 2).slice(1)
  return value
}
const out = flag('--out', '/tmp/peek-story-shots')
const waitFor = flag('--wait', '#storybook-root > *')
const measure = flag('--measure', '')
const [build, ...ids] = args
if (!build || ids.length === 0) {
  console.error('usage: render-story.mjs <build-dir> <story-id>… [--out dir] [--wait sel] [--measure sel]')
  process.exit(2)
}

const executablePath = join(homedir(), '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome')
if (!existsSync(executablePath)) {
  console.error(`no chromium at ${executablePath} — see render-a-peek-story-headlessly in memory`)
  process.exit(2)
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' }
const server = createServer(async (req, res) => {
  const path = resolve(build, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname))
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath })
const page = await browser.newPage({ viewport: { width: 720, height: 480 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

for (const id of ids) {
  errors.length = 0
  await page.goto(`http://127.0.0.1:${port}/iframe.html?id=${id}&viewMode=story`)
  await page.waitForSelector(waitFor, { timeout: 15_000 })
  await page.waitForTimeout(300)
  const text = await page.evaluate(() => document.querySelector('#storybook-root')?.textContent ?? '')
  const boxes = measure
    ? await page.evaluate((sel) =>
        [...document.querySelectorAll(sel)].map((el) => {
          const s = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return { text: el.textContent?.trim().slice(0, 60), w: +r.width.toFixed(1), h: +r.height.toFixed(1), padding: s.padding, radius: s.borderRadius, font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight}`, color: s.color, bg: s.backgroundColor }
        }), measure)
    : []
  const file = join(out, `${id}.png`)
  await page.screenshot({ path: file, fullPage: true })
  console.log(`\n== ${id} → ${file}`)
  console.log(`text: ${JSON.stringify(text.slice(0, 400))}`)
  for (const b of boxes) console.log(`  ${JSON.stringify(b)}`)
  for (const e of errors) if (!e.includes('favicon')) console.log(`  ! ${e}`)
}

await browser.close()
server.close()
