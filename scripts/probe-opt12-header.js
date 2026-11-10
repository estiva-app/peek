// OPT-12's probes: the middle column's header, read off the "File actions" strip — one shape for Desk and the page.
// An expression for `probe.mjs --eval "$(cat scripts/probe-opt12-header.js)"`.
(async () => {
  const strip = document.querySelector('[aria-label="File actions"]')
  let head = strip
  for (let i = 0; head && i < 6 && !head.querySelector('p.text-body-2-strong'); i++) head = head.parentElement
  const controls = head ? [...head.querySelectorAll('button, a')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()) : []
  const notice = [...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && /^Archived (with its .* )?by /.test(e.textContent))
  return {
    path: location.pathname + location.search,
    title: head?.querySelector('p.text-body-2-strong')?.textContent ?? null,
    chip: head?.querySelector('p.text-body-2-strong')?.nextElementSibling?.textContent ?? null,
    controls,
    archivedNotice: notice?.textContent ?? null,
    openFullPage: !!document.querySelector('[aria-label="Open full page"]'),
  }
})()
