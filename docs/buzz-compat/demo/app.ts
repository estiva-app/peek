/**
 * "Taskboard" — a second, independent app on the same Nostr channel Peek writes to.
 *
 * The point of this demo: Peek is a chat app, this is a task board. They share
 * **no database, no API, no webhook, no integration** — only a relay and a
 * channel UUID. A message sent in Peek appears here as a task; a task created
 * here appears in Peek as a message.
 *
 * It does import Peek's `convex/nostr/*` helpers, which deserves a caveat: those
 * are generic Nostr plumbing (event construction, BIP-340 signing, NIP-98 auth),
 * not Peek-specific logic. Nothing about Peek's data model crosses over. A truly
 * separate team would rewrite these few hundred lines in whatever language they
 * liked and interoperate identically — that is the whole claim.
 */
import { buildMessage, buildProfile, type SignedEvent } from '../../../convex/nostr/events'
import { publicKeyFromSecret, signEvent } from '../../../convex/nostr/sign'
import { authorizationHeader } from '../../../convex/nostr/nip98'

const RELAY = 'http://localhost:3000'
const STORAGE_KEY = 'taskboard.secret'
const POLL_MS = 3000

// ── Identity ────────────────────────────────────────────────────────────────
// This app has its OWN keypair, generated in the browser. It is a different
// person from anyone in Peek — visible in the UI as a different avatar colour.
function loadSecret(): string {
  let s = localStorage.getItem(STORAGE_KEY)
  if (!s) {
    s = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    localStorage.setItem(STORAGE_KEY, s)
  }
  return s
}

const SECRET = loadSecret()
const PUBKEY = publicKeyFromSecret(SECRET)

// ── Relay I/O ───────────────────────────────────────────────────────────────
async function bridge(path: string, payload: unknown): Promise<any> {
  const url = `${RELAY}${path}`
  const body = JSON.stringify(payload)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authorizationHeader({ pubkey: PUBKEY, secretKeyHex: SECRET, url, method: 'POST', body }),
    },
    body,
  })
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${res.status}: ${text.slice(0, 200)}`)
  }
}

/** `/query` takes a bare ARRAY of filters — see FRICTION.md A5. */
const fetchEvents = (channel: string, kinds: number[]) =>
  bridge('/query', [{ kinds, '#h': [channel], limit: 100 }]) as Promise<SignedEvent[]>

/** Profiles are global (no `h` tag), so they are fetched by author. */
const fetchProfiles = (authors: string[]) =>
  authors.length ? (bridge('/query', [{ kinds: [0], authors, limit: 100 }]) as Promise<SignedEvent[]>) : []

// ── State + rendering ───────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!
const channelInput = $('channel') as HTMLInputElement
const names = new Map<string, string>()

const shortKey = (pk: string) => pk.slice(0, 8)
const colorFor = (pk: string) => `hsl(${parseInt(pk.slice(0, 6), 16) % 360} 65% 55%)`
const nameFor = (pk: string) => names.get(pk) ?? `anon-${shortKey(pk)}`

function render(events: SignedEvent[]) {
  events.sort((a, b) => a.created_at - b.created_at)

  $('tasks').innerHTML =
    events
      .map((e) => {
        const mine = e.pubkey === PUBKEY
        return `<li class="task${mine ? ' mine' : ''}">
          <span class="dot" style="background:${colorFor(e.pubkey)}"></span>
          <div>
            <div class="who">${escape(nameFor(e.pubkey))}${mine ? ' <em>(this app)</em>' : ''}</div>
            <div class="body">${escape(e.content)}</div>
            <div class="meta">${new Date(e.created_at * 1000).toLocaleTimeString()} · ${e.id.slice(0, 12)}…</div>
          </div>
        </li>`
      })
      .join('') || '<li class="empty">No events in this channel yet.</li>'

  $('raw').textContent = JSON.stringify(events.slice(-3), null, 1)
  $('count').textContent = String(events.length)
}

function escape(s: string): string {
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

// ── Polling loop ────────────────────────────────────────────────────────────
// Polling rather than a WebSocket subscription purely to keep the demo small;
// the relay speaks NIP-01 REQ over WS for anything real-time.
async function tick() {
  const channel = channelInput.value.trim()
  if (!channel) return
  try {
    const events = await fetchEvents(channel, [9])
    const unknown = [...new Set(events.map((e) => e.pubkey))].filter((p) => !names.has(p))
    if (unknown.length) {
      for (const p of await fetchProfiles(unknown)) {
        try {
          const meta = JSON.parse(p.content)
          if (meta.display_name) names.set(p.pubkey, meta.display_name)
        } catch {
          /* a profile we cannot parse is not worth failing the render over */
        }
      }
    }
    render(events)
    setStatus(`connected · ${events.length} events`, 'ok')
  } catch (err) {
    setStatus(`relay error: ${(err as Error).message}`, 'bad')
  }
}

function setStatus(text: string, cls: 'ok' | 'bad') {
  const el = $('status')
  el.textContent = text
  el.className = cls
}

// ── Publishing ──────────────────────────────────────────────────────────────
async function publishTask(text: string) {
  const channel = channelInput.value.trim()
  const event = signEvent(
    buildMessage(PUBKEY, Date.now(), { channelUuid: channel, content: text }),
    SECRET,
  )
  const res = await bridge('/events', event)
  // HTTP 200 does not mean accepted — see FRICTION.md A2.
  if (res.accepted === false && !String(res.message ?? '').startsWith('duplicate:')) {
    throw new Error(res.message || res.error || 'rejected')
  }
  await tick()
}

async function announceSelf() {
  const event = signEvent(
    buildProfile(PUBKEY, Date.now(), { display_name: 'Taskboard user', about: 'Second app' }),
    SECRET,
  )
  await bridge('/events', event).catch(() => {})
}

// ── Wiring ──────────────────────────────────────────────────────────────────
$('pubkey').textContent = shortKey(PUBKEY)
;($('pubkey') as HTMLElement).style.color = colorFor(PUBKEY)

const form = $('compose') as HTMLFormElement
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const input = $('text') as HTMLInputElement
  const text = input.value.trim()
  if (!text) return
  input.disabled = true
  try {
    await publishTask(text)
    input.value = ''
  } catch (err) {
    setStatus(`publish failed: ${(err as Error).message}`, 'bad')
  } finally {
    input.disabled = false
    input.focus()
  }
})

channelInput.addEventListener('change', () => {
  names.clear()
  void tick()
})

void announceSelf().then(tick)
setInterval(tick, POLL_MS)
