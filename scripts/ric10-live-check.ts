/**
 * RIC-10: a pointer written mid-sentence is drawn where it was written.
 *
 * Peek's half of the ticket, checked in a real browser against a **recorded
 * production object** — `src/data/recordedShipIssue.json`, a real Ship issue
 * resolved from 1074 recorded production events through Peek's own
 * `resolveObjectAsViewer` and the projection layer. The title, the status and
 * its colour are what Ship's manifest declares, not something written here.
 *
 * **What this proves and what it does not.** It proves the rendering: the two
 * variants exist, the position chooses between them, and a reader never sees a
 * raw pointer either way. It does not exercise the live fetch — Peek reads its
 * token from a signed-in session, so a stub relay cannot be pointed at the app
 * the way Ship's `ric9-live-check.ts` points at Ship. `useResolvedReferences` calls the same `resolveObject` the attachment
 * widget has always called; that is an argument, not a measurement, and it is
 * the leg to check first if this ever looks wrong in production.
 *
 *   npx tsx scripts/ric10-live-check.ts
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type ConsoleMessage } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(here, '..', '.ric10')
const PORT = 6017
const recorded = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'recordedShipIssue.json'), 'utf8')) as {
  naddr: string
  object: { slots: { title: { value: string }; status: { value: string } } }
}
const TITLE = recorded.object.slots.title.value
const STATUS = recorded.object.slots.status.value

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  mkdirSync(SHOTS, { recursive: true })
  const storybook = spawn(
    'npx',
    ['storybook', 'dev', '-p', String(PORT), '--ci', '--no-open', '--quiet'],
    { cwd: join(here, '..'), stdio: 'ignore' },
  )

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 400 } })
  const errors: string[] = []
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  const story = async (id: string) => {
    // Storybook's dev server compiles on demand, so the first story is also the
    // build. Retried rather than given one long timeout: a failure here should
    // read as "it never came up", not as an assertion about the component.
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await page.goto(`http://localhost:${PORT}/iframe.html?id=${id}&viewMode=story`, { timeout: 5000 })
        await page.waitForSelector('[data-message-body]', { timeout: 5000 })
        return
      } catch {
        await page.waitForTimeout(1000)
      }
    }
    throw new Error(`story ${id} never rendered`)
  }

  const measure = async (id: string) => {
    await story(id)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, `${id.split('--')[1]}.png`) })
    const body = page.locator('[data-message-body]')
    // The prose only: the paragraphs, not the card that may sit below them.
    const prose = (await body.locator('p, ul, ol, h1, h2, h3, blockquote').allTextContents()).join(' ')
    return {
      prose,
      pointerShown: prose.includes('naddr1'),
      inlineChip: await body.locator('[data-reference="object"]').count(),
      inlineNamesIt: (await body.locator('[data-reference="object"]').allTextContents()).some((t) => t.includes(TITLE)),
      inlineShowsStatus: (await body.locator('[data-reference="object"]').allTextContents()).some((t) => t.includes(STATUS)),
      /*
        How tall the chip actually is, because everything above reads the DOM
        and the DOM cannot see a layout. The first run drew this correctly and
        looked wrong: an 84-character production title wrapped the chip onto two
        lines and left its status pill floating in the middle of the gap, with
        every assertion green. A mention is a word in a sentence, so it is one
        line high or it is not a mention.
      */
      inlineHeight: (await body.locator('[data-reference="object"]').count())
        ? ((await body.locator('[data-reference="object"]').first().boundingBox())?.height ?? 0)
        : 0,
      card: await body.locator('[data-foreign-object]').count(),
    }
  }

  const inline = await measure('messages-messagebody--inline-reference')
  const standalone = await measure('messages-messagebody--standalone-reference')

  console.log(`   inline    : prose=${JSON.stringify(inline.prose.slice(0, 48))} chips=${inline.inlineChip} cards=${inline.card}`)
  console.log(`   standalone: prose=${JSON.stringify(standalone.prose.slice(0, 60))} chips=${standalone.inlineChip} cards=${standalone.card}`)

  check('a mid-sentence pointer is drawn in place', inline.inlineChip === 1)
  check('and names the object, not its address', inline.inlineNamesIt, TITLE.slice(0, 40))
  check('and shows the status the manifest declares', inline.inlineShowsStatus, STATUS)
  /*
    The done-when's cross-app clause, as a string comparison.

    This is the same body Ship's `ric9-live-check.ts` renders, and this is the
    sentence Ship prints for it. Both apps reach it by calling
    `standaloneReference` and `toRenderTree` from `@estiva-app/protocol`, which
    is the point: the rule is in the package, so the two cannot drift into
    disagreeing about which pointers survive the prose.

    The words around the reference, not the whole string: the chip carries the
    status inside it, so the paragraph's text content reads "…issue's doesTodo
    for now." Ship's check prints the first 48 characters of its own, and they
    are byte-identical to the 48 printed above.
  */
  const sentence = inline.prose.trim()
  check(
    'the sentence it was written in survives',
    sentence.startsWith(`Tracked in ${TITLE}`) && sentence.endsWith('for now.'),
    JSON.stringify(sentence.slice(0, 48)),
  )
  check('and the chip sits on one line of it', inline.inlineHeight > 0 && inline.inlineHeight < 30, `${inline.inlineHeight}px`)
  check('the reader never sees the raw pointer', !inline.pointerShown)
  check('a mid-sentence pointer is not also drawn below', inline.card === 0)

  check('a pointer alone on its line stays a card below', standalone.card === 1)
  check('and is not also drawn in the prose', standalone.inlineChip === 0)
  check('and leaves the prose it was not part of alone', standalone.prose.trim() === 'Tracked in it for now.')
  check('the standalone pointer is not shown either', !standalone.pointerShown)

  check('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '))

  await browser.close()
  storybook.kill('SIGTERM')
  console.log(failures ? `\n${failures} failed` : '\nall checks passed')
  process.exit(failures ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
