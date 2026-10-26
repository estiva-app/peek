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
  const relay = (h) => /estiva\.estiva\.app$/.test(h.host)

  const NativeWS = window.WebSocket
  window.WebSocket = class extends NativeWS {
    constructor(...args) {
      super(...args)
      sp.ws.push({ at: now(), dir: 'open', url: String(args[0]).slice(0, 80) })
      this.addEventListener('message', (e) => {
        const text = String(e.data)
        const type = /^\["(\w+)"/.exec(text)?.[1]
        if (type === 'CLOSED' || type === 'NOTICE' || (type === 'OK' && /^\["OK",[^,]+,false/.test(text))) {
          sp.ws.push({ at: now(), dir: 'in', type, body: text.slice(0, 200) })
          if (refused(text)) sp.refusals.push({ at: now(), via: 'ws', body: text.slice(0, 200) })
        }
      })
    }
    send(data) {
      const text = String(data)
      sp.ws.push({ at: now(), dir: 'out', type: /^\["(\w+)"/.exec(text)?.[1] ?? '?', bytes: text.length })
      return super.send(data)
    }
  }

  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href)
    const method = init?.method || (typeof input === 'object' && input.method) || 'GET'
    const entry = { at: now(), method, host: url.host, path: url.pathname }
    sp.http.push(entry)
    try {
      const response = await nativeFetch(input, init)
      entry.status = response.status
      entry.ms = now() - entry.at
      if (response.status === 429) sp.refusals.push({ at: now(), via: 'http', path: url.pathname })
      // Bytes of a relay answer, read from a clone so the app's own read is untouched.
      if (/\/(query|events|count)$/.test(url.pathname)) {
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

  // ms since the last relay read started or finished: the whole load is over once this stays high.
  sp.quiet = () => (sp.http.some((h) => relay(h) && h.pending) ? 0 : now() - Math.max(0, ...sp.http.filter(relay).map((h) => h.done ?? h.at + (h.ms ?? 0))))
  sp.report = (label) => {
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
      statuses: reads.reduce((s, h) => ({ ...s, [h.status ?? h.error ?? 'pending']: (s[h.status ?? h.error ?? 'pending'] ?? 0) + 1 }), {}),
      refusals: sp.refusals,
      socketIn: sp.ws.filter((w) => w.dir === 'in'),
      mbByKind: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, b]) => [k, +(b / 1e6).toFixed(2)])),
      biggest: [...reads].sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)).slice(0, 3).map((h) => ({ path: h.path, bytes: h.bytes, ms: h.ms, at: h.at })),
    })
  }
})()
