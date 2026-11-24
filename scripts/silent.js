// Probe --init (46c5d0aa, Done-when leg 4): a relay that takes a read and then goes silent, from the moment
// localStorage 'probe.silent' is 'on' (set by an --eval before --tab, so the first open fills the copy normally).
// The socket still opens, still authenticates (AUTH/OK pass), and takes every REQ; no EVENT, EOSE, CLOSED or NOTICE
// reaches the app. HTTP /query, /count and /events never answer (they reject only if the app aborts them).
;(() => {
  if (!/^peek\.estiva\.app$/.test(location.hostname)) return
  // Read on every frame and fetch, so an --eval setting it to 'off' brings the relay back in the same tab (Done-when leg 2).
  const on = () => localStorage.getItem('probe.silent') === 'on'
  const relay = (url) => on() && /estiva\.estiva\.app/.test(String(url))
  window.__silent = { swallowed: 0, hung: 0 }
  const Native = window.WebSocket
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args)
      if (!/estiva\.estiva\.app/.test(String(args[0]))) return
      // Registered first, so stopImmediatePropagation keeps the frame from every later listener and onmessage.
      this.addEventListener('message', (e) => {
        if (on() && /^\["(EVENT|EOSE|CLOSED|NOTICE)"/.test(String(e.data))) {
          e.stopImmediatePropagation()
          window.__silent.swallowed++
        }
      })
    }
  }
  const fetch = window.fetch
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? String(input)
    if (!relay(url) || !/\/(query|count|events)(\?|$)/.test(new URL(url, location.href).pathname)) return fetch.call(this, input, init)
    window.__silent.hung++
    return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }
})()
