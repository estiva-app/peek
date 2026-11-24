/**
 * The desk-reopen leg's summary (app-speed.mjs --legs desk-reopen): from every question the reopen asked over the
 * socket and HTTP (the recorder's `wire`), when the Desk's own rows were current, when the relay went quiet, how many
 * questions, and the megabytes both ways.
 *
 * "The Desk's rows are current" is the last answer to a question one of the Desk's own stores asks — Open work, the
 * Screener and the stars (their blobs), the read state behind the dots, the direct-message channels, and the topics'
 * listed news — not the relay going quiet. A store's question is told by its filter, below. Run it again on a saved
 * run with `node scripts/app-speed-reopen.mjs <app-speed.json>`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const filtersOf = (ask) => {
  try {
    const parsed = JSON.parse(ask.filter ?? '')
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : null)
const has = (f, kind) => (f.kinds ?? []).includes(kind)

/** The Desk's own questions, each by the store that asks it. */
export const DESK_STORES = {
  // openWork.ts, screener.ts, stars.ts, readState.ts: one 30078 blob each, by its `d`.
  'open work': (f) => has(f, 30078) && (f['#d'] ?? []).some((d) => /:open-work:/.test(d)),
  screener: (f) => has(f, 30078) && (f['#d'] ?? []).some((d) => /:screener:/.test(d)),
  stars: (f) => has(f, 30078) && (f['#d'] ?? []).some((d) => /:stars:/.test(d)),
  // readState.ts: every slot of the person's read state, by #t (asked again every 30 s; only the first ask counts).
  'read state': (f) => has(f, 30078) && (f['#t'] ?? []).includes('read-state'),
  // dms.ts dmChannelFilters: the person's DM channels, by #p or #t dm.
  'direct messages': (f) => has(f, 39000) && (f['#p'] !== undefined || (f['#t'] ?? []).includes('dm')),
}

const storeOf = (ask) => {
  for (const f of filtersOf(ask)) for (const [name, test] of Object.entries(DESK_STORES)) if (test(f)) return name
  return null
}

/** One reopen: the Desk's stores with their last answer, the relay's quiet, the questions and the megabytes. */
export function reopenSummary(report) {
  const wire = report.wire
  if (!wire) return null
  // Each store's first question and its answer: a later ask is a refresh, not the reopen catching up.
  const stores = {}
  for (const ask of wire.asks) {
    const name = storeOf(ask)
    if (!name) continue
    if (stores[name]) stores[name].asks++
    else stores[name] = { asks: 1, asked: ask.at, answered: ask.done }
  }
  const answered = Object.values(stores).map((s) => s.answered ?? Infinity)
  // The last change of the Desk on screen up to the relay's quiet: rows, their text and their dots.
  const changes = (wire.changes ?? []).filter((t) => wire.quietAt === null || t <= wire.quietAt + 1000)
  const missing = Object.keys(DESK_STORES).filter((n) => !stores[n])
  const http = wire.asks.filter((a) => a.via === 'http')
  const mbHttp = http.reduce((n, a) => n + a.bytes, 0) / 1e6
  const keys = new Set(wire.asks.map((a) => a.filter))
  return {
    deskOnScreen: report.marks?.allTexts ?? null,
    storesAnswered: answered.length ? Math.max(...answered) : null,
    rowsCurrent: changes.at(-1) ?? null,
    // How many moments the Desk changed after it was first on screen, and in which seconds: a Desk that redraws for 20 s.
    changesAfterPaint: changes.filter((t) => t > (report.marks?.allTexts ?? 0)).length,
    changeSeconds: [...new Set(changes.map((t) => Math.floor(t / 1000)))],
    missingStores: missing,
    quiet: wire.quietAt,
    questions: wire.asks.length,
    socketQuestions: wire.asks.length - http.length,
    httpQuestions: http.length,
    askedTwice: wire.asks.length - keys.size,
    mb: +(wire.socket.mbIn + wire.socket.mbOut + mbHttp).toFixed(1),
    mbSocket: +(wire.socket.mbIn + wire.socket.mbOut).toFixed(1),
    mbHttp: +mbHttp.toFixed(1),
    copy: report.copy ?? null,
    // Events that came over the socket for the reopen's questions, against the copy's events (HTTP answers are
    // counted in bytes only).
    socketEvents: wire.asks.reduce((n, a) => n + (a.events ?? 0), 0),
    // What one catch-up round costs: a question answered with under 2 KB (an unchanged set's answer is that small),
    // its median time from asked to answered. A catch-up of an unchanged set is one such round per question.
    roundMs: median(wire.asks.filter((a) => a.done !== null && a.bytes < 2048).map((a) => a.done - a.at)),
    stores,
  }
}

const s1 = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)} s`)

/** The reopen runs as a table: one row per run. */
export function reopenTable(runs) {
  const lines = [
    '| Run | Desk on screen | Stores answered | Rows last changed | Relay quiet | Questions (socket + HTTP) | Asked twice | MB (socket + HTTP) | Copy before → after |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  runs.forEach((r, i) => {
    const s = reopenSummary(r)
    if (!s) return lines.push(`| ${i + 1} | ${r.failure ?? 'no wire'} | | | | | | | |`)
    const copy = s.copy ? s.copy.map((c) => (c.events === undefined ? c.error : `${c.events} ev`)).join(' → ') : '–'
    lines.push(`| ${i + 1} | ${s1(s.deskOnScreen)} | ${s1(s.storesAnswered)}${s.missingStores.length ? ` (not asked: ${s.missingStores.join(', ')})` : ''} | ${s1(s.rowsCurrent)} | ${s1(s.quiet)} | ${s.questions} (${s.socketQuestions} + ${s.httpQuestions}) | ${s.askedTwice} | ${s.mb} (${s.mbSocket} + ${s.mbHttp}) | ${copy} |`)
  })
  return lines.join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const runs = result.rows['desk-reopen'] ?? []
  console.log(reopenTable(runs))
  for (const [i, r] of runs.entries()) {
    const s = reopenSummary(r)
    console.log(`run ${i + 1} stores:`, JSON.stringify(s?.stores), 'Desk changed in seconds:', JSON.stringify(s?.changeSeconds), `socket events ${s?.socketEvents}, small round ${s?.roundMs} ms`)
  }
}
