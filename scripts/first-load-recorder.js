// Init script for probe.mjs --init (probe-first-load.mjs): records, from a page's first byte, when things first
// appear, per phase. Times are performance.now() of this document (ms since its navigation started).
// A phase is opened by `__fl.phase(label, texts)`; its marks are when its texts, a composer, the first message and
// a page with no placeholders were first on screen. `__fl.report()` returns everything as JSON.
;(() => {
  // localhost: a local build served at the origin Estiva ID accepts, with real HTTP caching.
  if (!location.hostname.startsWith('peek.') && location.hostname !== 'localhost') return
  const now = () => Math.round(performance.now())
  const fl = (window.__fl = { phases: [], ws: [], subs: [], refusals: [] })
  let cur = null
  // The message at the bottom of the message list, and where it sits (watchScroll).
  let anchor = null
  // `path`: the texts count only once Peek is on it — Desk's rows name the same topics as the Topics tree.
  fl.phase = (label, texts = [], path = null) => {
    cur = { label, at: now(), texts, path, marks: {}, pulses: [], jumps: [] }
    anchor = null
    fl.phases.push(cur)
    return cur.at
  }
  let saved = []
  try {
    saved = JSON.parse(sessionStorage.getItem('fl.texts') || '[]')
    // The first Peek document of this tab, before any sign-in redirect: a boot's total starts there.
    if (!sessionStorage.getItem('fl.first')) sessionStorage.setItem('fl.first', String(performance.timeOrigin))
    fl.first = Number(sessionStorage.getItem('fl.first'))
  } catch {}
  fl.origin = performance.timeOrigin
  fl.phase('load', saved.length ? saved : (window.__flDefault ?? []))

  const mark = (name) => {
    if (cur && !(name in cur.marks)) cur.marks[name] = now()
  }
  // Nobody scrolls during a probe, so each time the message at the bottom of the list moves or is replaced by
  // another, the person would have seen the list jump.
  const watchScroll = (main) => {
    const first = main.querySelector('[data-root]')
    if (!first) return
    mark('messages')
    let scroller = first.parentElement
    while (scroller && scroller !== main && !(scroller.scrollHeight > scroller.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(scroller).overflowY)))
      scroller = scroller.parentElement
    if (!scroller || scroller === main) return
    const box = scroller.getBoundingClientRect()
    // The last message whose top is in view. A `data-root` wrapper is `display: contents`: its child has the box.
    const roots = scroller.querySelectorAll('[data-root]')
    let next = null
    for (let i = roots.length - 1; i >= 0 && !next; i--) {
      const top = roots[i].firstElementChild?.getBoundingClientRect().top
      if (top !== undefined && top < box.bottom) next = { id: roots[i].dataset.root, top: Math.round(top - box.top) }
    }
    if (!next) return
    if (anchor && (anchor.id !== next.id || Math.abs(anchor.top - next.top) > 8))
      cur.jumps.push([now(), anchor.id === next.id ? `moved ${next.top - anchor.top}px` : 'replaced'])
    anchor = next
  }
  let lastPulse = -1
  let lastEditor = null
  let lastPath = null
  const tick = () => {
    const main = document.querySelector('main')
    if (document.querySelector('a[href="/app/desk"]')) mark('shell')
    if (main) {
      const pulses = main.querySelectorAll('.animate-pulse,[aria-busy=true]').length
      if (pulses !== lastPulse) {
        cur.pulses.push([now(), pulses])
        lastPulse = pulses
      }
      const editor = main.querySelector('[contenteditable=true]')
      if (editor) mark('composer')
      // A new composer element, or a new path: what a person sees as the view "reloading".
      if (editor !== lastEditor) {
        cur.editors = (cur.editors ?? []).concat([[now(), editor ? 'composer' : 'none']])
        lastEditor = editor
      }
      if (location.pathname !== lastPath) {
        cur.paths = (cur.paths ?? []).concat([[now(), location.pathname.slice(0, 60)]])
        lastPath = location.pathname
      }
      const text = !cur.path || location.pathname.startsWith(cur.path) ? main.textContent || '' : ''
      for (const t of cur.texts) if (text.includes(t)) mark(`text:${t}`)
      if (cur.texts.length && cur.texts.every((t) => text.includes(t))) {
        mark('allTexts')
        if (pulses === 0) mark('allTextsNoPulse')
      }
      watchScroll(main)
    }
    setTimeout(tick, 25)
  }
  setTimeout(tick, 0)

  const Native = window.WebSocket
  window.WebSocket = function (url, protocols) {
    const ws = new Native(url, protocols)
    const rec = { url: String(url).slice(0, 80), created: now(), reqs: 0 }
    fl.ws.push(rec)
    ws.addEventListener('open', () => (rec.open = now()))
    ws.addEventListener('message', (e) => {
      const s = String(e.data)
      if (s.startsWith('["AUTH"')) rec.authChallenge ??= now()
      else if (s.startsWith('["OK"') && rec.authSent && !rec.authOk) rec.authOk = now()
      else if (s.startsWith('["EOSE"')) {
        rec.firstEose ??= now()
        const id = s.slice(9, s.indexOf('"', 9))
        const sub = fl.subs.findLast((x) => x.id === id && x.eose === undefined)
        if (sub) sub.eose = now()
      } else if (s.startsWith('["EVENT"')) {
        const id = s.slice(10, s.indexOf('"', 10))
        const sub = fl.subs.findLast((x) => x.id === id && x.eose === undefined)
        if (sub) sub.n++
      }
      if (s.startsWith('["CLOSED"')) rec.closed = (rec.closed ?? 0) + 1
      // What the relay refused: a CLOSED with a reason (one without answers Peek's own CLOSE), a NOTICE, or an
      // OK that says no.
      if (/^\["CLOSED",[^,]+,"[^"]/.test(s) || s.startsWith('["NOTICE"') || /^\["OK",[^,]+,false/.test(s))
        if (fl.refusals.length < 50) fl.refusals.push([now(), s.slice(0, 200)])
    })
    const send = ws.send.bind(ws)
    ws.send = (data) => {
      const s = String(data)
      if (s.startsWith('["AUTH"')) rec.authSent ??= now()
      if (s.startsWith('["REQ"')) {
        rec.reqs++
        rec.firstReq ??= now()
        try {
          const [, id, ...filters] = JSON.parse(s)
          const what = filters
            .map((f) => `${(f.kinds ?? []).join('/')}${Object.keys(f).filter((k) => k.startsWith('#')).join('')}${f.ids ? `ids${f.ids.length}` : ''}${f.limit ? `L${f.limit}` : ''}`)
            .join('+')
          if (fl.subs.length < 1500) fl.subs.push({ id, at: now(), what, n: 0 })
        } catch {}
      }
      return send(data)
    }
    return ws
  }
  window.WebSocket.prototype = Native.prototype
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })

  // What the run ends with: phases, sockets, refusals, and the HTTP reads and writes with their timing and status.
  fl.report = () => {
    const res = performance
      .getEntriesByType('resource')
      .filter((r) => ['fetch', 'xmlhttprequest'].includes(r.initiatorType))
      .map((r) => {
        const u = new URL(r.name)
        return [Math.round(r.startTime), Math.round(r.responseEnd), `${u.hostname.split('.')[0]}${u.pathname}`.slice(0, 60), r.responseStatus]
      })
    const nav = performance.getEntriesByType('navigation')[0]
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]))
    return JSON.stringify({
      beforeThisDoc: Math.round(fl.origin - (fl.first ?? fl.origin)),
      nav: nav && { responseEnd: Math.round(nav.responseEnd), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) },
      paint,
      // The saved Desk index.html showed, and when the live Desk replaced it (src/lib/deskPicture.ts).
      picture: window.__peekPicture ?? null,
      phases: fl.phases.map(({ texts, ...p }) => ({ ...p, pulses: p.pulses.slice(0, 12), jumps: p.jumps.slice(0, 20) })),
      ws: fl.ws,
      subs: fl.subs.map((x) => [x.at, x.eose ?? null, x.n, x.what]),
      refusals: fl.refusals,
      res,
    })
  }
})()
