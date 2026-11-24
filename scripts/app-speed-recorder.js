// Init script for probe.mjs --init (app-speed.mjs, "Apps read only what they show"): records, from a Leaf, Ship or
// Peek page's first byte, every relay read (HTTP /query, /events, /count: path, status, ms, bytes, kinds answered),
// the socket frames sent, anything the relay refused (a CLOSED, a NOTICE, an OK false, an HTTP 429, a rate-limit
// answer), when each awaited text was first on screen and when the page first had no placeholder outside the sidebar.
// Times are performance.now() of this document. app-speed.mjs puts `window.__spAwait` ([hostRe, pathRe, texts][]) in
// front of this file; a text is a string, or `{ re }` for a regular expression.
;(() => {
  if (!/^(leaf|ship|peek)\.estiva\.app$/.test(location.hostname)) return
  const now = () => Math.round(performance.now())
  const sp = (window.__sp = { href: location.href, origin: performance.timeOrigin, ws: [], http: [], refusals: [], marks: {}, placeholders: [] })
  // The first document of this tab's sign-in: Estiva ID bounces the app to its origin twice, and the wait a person
  // sees starts at the first one.
  try {
    if (!sessionStorage.getItem('sp.first')) sessionStorage.setItem('sp.first', String(performance.timeOrigin))
    sp.first = Number(sessionStorage.getItem('sp.first'))
  } catch {
    sp.first = performance.timeOrigin
  }
  // After a sign-in bounce the document starts at /?code= and the app routes on the client: the texts follow the
  // path the page is on now.
  const awaited = () => (window.__spAwait ?? []).find(([h, p]) => new RegExp(h).test(location.hostname) && new RegExp(p).test(location.pathname))?.[2] ?? []
  const key = (t) => (typeof t === 'string' ? t : `/${t.re}/`)
  const shows = (text, t) => (typeof t === 'string' ? text.includes(t) : new RegExp(t.re).test(text))
  const refused = (text) => /rate.?limit|too many|slow down/i.test(text)
  // The relay failing to answer at all, not refusing a quota: a busy database shows as "no community is configured"
  // (a 404), a 500 or 503, a socket that never opens, or a subscription closed with an error (APP-9).
  sp.failed = []
  const failedAnswer = (text) => /no community|busy|internal|failed|error:/i.test(text) && !refused(text)
  const relay = (h) => /estiva\.estiva\.app$/.test(h.host)
  // A query body as each filter's kinds and its other keys, a list key by its count: "1851 #a×412".
  const shapeOf = (body) => {
    try {
      const filters = JSON.parse(body)
      return (Array.isArray(filters) ? filters : [filters])
        .map((f) => [(f.kinds ?? []).join(','), ...Object.entries(f).filter(([k]) => k !== 'kinds').map(([k, v]) => (Array.isArray(v) ? `${k}×${v.length}` : `${k}=${v}`))].join(' '))
        .join(' | ')
    } catch {
      return undefined
    }
  }

  // Every question over the relay's socket, with what it was answered (desk-reopen, 46c5d0aa): the socket carries most
  // of a Peek open, and the HTTP counts above miss it. One row per REQ: its filter, the bytes and events that came for
  // it, and when its EOSE came (`done`); `sp.socket` sums every frame both ways.
  sp.subs = []
  sp.socket = { in: 0, out: 0, lastIn: null, times: [] }
  let sockets = 0
  const NativeWS = window.WebSocket
  window.WebSocket = class extends NativeWS {
    constructor(...args) {
      super(...args)
      sp.ws.push({ at: now(), dir: 'open', url: String(args[0]).slice(0, 80) })
      const toRelay = relay(new URL(String(args[0])))
      this.__spSubs = new Map()
      this.__spRelay = toRelay
      this.__spN = ++sockets
      let opened = false
      this.addEventListener('open', () => (opened = true))
      this.addEventListener('close', (e) => {
        if (!opened && toRelay) sp.failed.push({ at: now(), via: 'ws-upgrade', code: e.code })
      })
      this.addEventListener('message', (e) => {
        const text = String(e.data)
        if (toRelay) {
          sp.socket.in += text.length
          sp.socket.lastIn = now()
          if (window.__spWatch) sp.socket.times.push(sp.socket.lastIn)
          // ["EVENT","<sub>",…] / ["EOSE","<sub>"] / ["CLOSED","<sub>",…]: the verb and the sub id, without parsing the event.
          const verb = text.slice(2, text.indexOf('"', 2))
          const from = text.indexOf('"', text.indexOf(',') + 1)
          const sub = this.__spSubs.get(text.slice(from + 1, text.indexOf('"', from + 1)))
          if (sub && verb === 'EVENT') {
            sub.bytes += text.length
            sub.events++
          }
          if (sub && verb === 'EOSE' && sub.done === null) sub.done = now()
          // A refused or closed question is over, not answered: the summary counts it as unanswered.
          if (sub && verb === 'CLOSED' && sub.done === null) sub.done = now(), (sub.closed = text.slice(0, 160))
        }
        const type = /^\["(\w+)"/.exec(text)?.[1]
        if (type === 'CLOSED' || type === 'NOTICE' || (type === 'OK' && /^\["OK",[^,]+,false/.test(text))) {
          sp.ws.push({ at: now(), dir: 'in', type, body: text.slice(0, 200) })
          if (refused(text)) sp.refusals.push({ at: now(), via: 'ws', body: text.slice(0, 200) })
          if (type !== 'OK' && failedAnswer(text)) sp.failed.push({ at: now(), via: 'ws', body: text.slice(0, 200) })
        }
      })
    }
    send(data) {
      const text = String(data)
      const type = /^\["(\w+)"/.exec(text)?.[1] ?? '?'
      sp.ws.push({ at: now(), dir: 'out', type, bytes: text.length })
      if (this.__spRelay) {
        sp.socket.out += text.length
        if (type === 'REQ') {
          try {
            const frame = JSON.parse(text)
            const filters = JSON.stringify(frame.slice(2))
            const sub = { via: 'ws', socket: this.__spN, sub: frame[1], at: now(), filter: filters.slice(0, 2000), shape: shapeOf(filters)?.slice(0, 400), out: text.length, bytes: 0, events: 0, done: null }
            this.__spSubs.set(frame[1], sub)
            sp.subs.push(sub)
          } catch {}
        }
      }
      return super.send(data)
    }
  }

  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href)
    const method = init?.method || (typeof input === 'object' && input.method) || 'GET'
    const entry = { at: now(), method, host: url.host, path: url.pathname }
    // What was asked, so the biggest reads name their filter (TEA-5's 44 MB read).
    if (typeof init?.body === 'string') entry.filter = init.body.slice(0, 2000)
    // Each filter's kinds and how many values each tag names, whole: a long filter's tail is past the 2000 kept above (ISS-6).
    if (typeof init?.body === 'string') entry.shape = shapeOf(init.body)
    sp.http.push(entry)
    try {
      const response = await nativeFetch(input, init)
      entry.status = response.status
      entry.ms = now() - entry.at
      if (response.status === 429) sp.refusals.push({ at: now(), via: 'http', path: url.pathname })
      // A 404 is "no community" only on the relay's read doors; elsewhere (a deleted blob) it is a real answer.
      const readDoor = /\/(query|events|count)$/.test(url.pathname)
      if (relay(entry) && (response.status >= 500 || (response.status === 404 && readDoor))) sp.failed.push({ at: now(), via: 'http', path: url.pathname, status: response.status })
      // Bytes of a relay answer, read from a clone so the app's own read is untouched.
      if (readDoor) {
        entry.pending = true
        response.clone().text().then((t) => {
          entry.bytes = t.length
          entry.done = now()
          if (response.status >= 400 && refused(t)) sp.refusals.push({ at: now(), via: 'http-body', path: url.pathname, body: t.slice(0, 160) })
          try {
            const answer = JSON.parse(t)
            const kinds = {}
            for (const e of Array.isArray(answer) ? answer : answer.events ?? []) if (e && typeof e === 'object') kinds[e.kind] = (kinds[e.kind] ?? 0) + JSON.stringify(e).length
            entry.kinds = kinds
          } catch {}
        }).catch(() => {}).finally(() => { entry.pending = false })
      }
      return response
    } catch (error) {
      entry.error = String(error).slice(0, 80)
      throw error
    }
  }

  const PLACEHOLDER = '[class*=animate-pulse], [aria-busy=true], [class*=skeleton], [data-skeleton]'
  let wasPlaceholder = false
  setInterval(() => {
    const body = document.body
    if (!body) return
    // The page's own text, not the sidebar's: a tree row can carry the same words before the page has drawn.
    const text = (document.querySelector('main') ?? body).innerText ?? ''
    const texts = awaited()
    for (const t of texts) if (!(key(t) in sp.marks) && shows(text, t)) sp.marks[key(t)] = now()
    // The page's own placeholders: Leaf's sidebar tree keeps some that never resolve, counted in `left`.
    const ph = [...body.querySelectorAll(PLACEHOLDER)].filter((el) => !el.closest('aside, nav')).length
    if (ph && !wasPlaceholder) sp.placeholders.push([now(), 'on', ph])
    if (!ph && wasPlaceholder) sp.placeholders.push([now(), 'off'])
    wasPlaceholder = !!ph
    const all = texts.length > 0 && texts.every((t) => key(t) in sp.marks)
    if (all && !('allTexts' in sp.marks)) sp.marks.allTexts = now()
    if (all && !ph && !('allNoPlaceholder' in sp.marks)) sp.marks.allNoPlaceholder = now()
  }, 25)

  // When the page's own area last changed on screen, outside the sidebar (desk-reopen): a row, its text or its dot. The
  // Desk's rows are current once they stop changing, whichever read brought the last change.
  sp.changes = []
  // The body, not <main>: the app replaces its <main> as it routes, and an observer on the old one hears nothing.
  const inPage = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement
    return !!el?.closest('main') && !el.closest('aside, nav')
  }
  const watch = () => {
    if (!document.body) return setTimeout(watch, 50)
    new MutationObserver((records) => {
      if (records.some((r) => inPage(r.target))) {
        const t = now()
        if (sp.changes.at(-1) !== t) sp.changes.push(t)
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-state', 'aria-label'] })
  }
  // Only when app-speed asks (desk-reopen's `window.__spWatch`): the other legs' pages are timed without this work.
  if (!window.__spWatch) {
    // nothing to watch
  } else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch)
  else watch()

  // ms since the last relay read started or finished: the whole load is over once this stays high.
  sp.quiet = () => (sp.http.some((h) => relay(h) && h.pending) ? 0 : now() - Math.max(0, ...sp.http.filter(relay).map((h) => h.done ?? h.at + (h.ms ?? 0))))
  // The same, counting the socket's frames too: Peek reads mostly over its socket (desk-reopen).
  sp.quietAll = () => Math.min(sp.quiet(), sp.socket.lastIn === null ? Infinity : now() - sp.socket.lastIn)
  // Every question of the open over both doors, and when the relay went quiet: the last answer before 5 s with none.
  sp.asks = () => {
    const http = sp.http.filter((h) => relay(h) && /\/(query|count)$/.test(h.path))
      .map((h) => ({ via: 'http', at: h.at, filter: h.filter, shape: h.shape?.slice(0, 400), bytes: h.bytes ?? 0, events: undefined, done: h.done ?? null, status: h.status }))
    const asks = [...sp.subs.map(({ socket, sub, out, ...rest }) => rest), ...http].sort((a, b) => a.at - b.at)
    const moments = [...sp.socket.times, ...http.filter((h) => h.done !== null).map((h) => h.done)].sort((a, b) => a - b)
    let quietAt = moments[0] ?? null
    for (const m of moments) {
      if (m - quietAt > 5000) break
      quietAt = m
    }
    const perSecond = {}
    for (const t of sp.socket.times) perSecond[Math.floor(t / 1000)] = (perSecond[Math.floor(t / 1000)] ?? 0) + 1
    return { asks, quietAt, changes: sp.changes, socket: { mbIn: sp.socket.in / 1e6, mbOut: sp.socket.out / 1e6, frames: sp.socket.times.length }, framesPerSecond: perSecond }
  }
  sp.report = (label, everyRead = false) => {
    const reads = sp.http.filter(relay)
    const until = (at) => reads.filter((h) => at !== undefined && h.at <= at)
    const mb = (list) => list.reduce((n, h) => n + (h.bytes ?? 0), 0) / 1e6
    const left = { aside: 0, main: 0, other: 0 }
    for (const el of document.querySelectorAll(PLACEHOLDER)) left[el.closest('aside, nav') ? 'aside' : el.closest('main') ? 'main' : 'other']++
    const kinds = {}
    for (const h of reads) for (const [k, b] of Object.entries(h.kinds ?? {})) kinds[k] = (kinds[k] ?? 0) + b
    return JSON.stringify({
      label,
      href: location.href,
      // The app's own bundle: tells a run on the old build from one on the new.
      build: [...document.querySelectorAll('script[type=module][src]')].map((s) => new URL(s.src).pathname).find((p) => /assets\//.test(p)) ?? null,
      at: now(),
      texts: awaited().map(key),
      marks: sp.marks,
      bounceMs: Math.round(sp.origin - sp.first),
      left,
      placeholders: sp.placeholders,
      reads: reads.length,
      mb: mb(reads),
      readsAtText: until(sp.marks.allTexts).length,
      mbAtText: mb(until(sp.marks.allTexts)),
      socketReqs: sp.ws.filter((w) => w.dir === 'out' && w.type === 'REQ').length,
      // What came over the socket, which `mb` (HTTP only) leaves out.
      mbSocket: sp.socket.in / 1e6,
      // desk-reopen: every question both ways, for app-speed.mjs to find the Desk's own and when they were answered.
      ...(label.startsWith('desk-reopen') ? { wire: sp.asks() } : {}),
      statuses: reads.reduce((s, h) => ({ ...s, [h.status ?? h.error ?? 'pending']: (s[h.status ?? h.error ?? 'pending'] ?? 0) + 1 }), {}),
      refusals: sp.refusals,
      failed: sp.failed,
      socketIn: sp.ws.filter((w) => w.dir === 'in'),
      mbByKind: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, b]) => [k, +(b / 1e6).toFixed(2)])),
      biggest: [...reads].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 3).map((h) => ({ path: h.path, bytes: h.bytes, ms: h.ms, at: h.at, filter: h.filter })),
      // Each read's filter as asked (up to the 2000 characters kept above): its heads say which part of the app asked (APP-11).
      ...(everyRead ? { everyRead: reads.map((h) => ({ path: h.path, at: h.at, ms: h.ms, bytes: h.bytes, filter: h.filter, shape: h.shape })) } : {}),
    })
  }
})()
