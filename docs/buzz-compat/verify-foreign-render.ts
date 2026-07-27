/**
 * The actual claim, end to end.
 *
 * Linear-lite publishes a project, an issue, changes and comments. Then PEEK's
 * code — a different implementation, importing nothing from Linear-lite except
 * the naddr string a user would have pasted — renders it from the manifest.
 */
import { randomUUID } from 'node:crypto'
import { Relay } from '/home/miky/linear-lite/lib/nostr/relay'
import { publicKeyFromSecret } from '/home/miky/linear-lite/lib/nostr/sign'
import { Store } from '/home/miky/linear-lite/src/store'
import { addrToNaddr } from '/home/miky/linear-lite/lib/nostr/nip19'
import { resolveForeignObject } from '/home/miky/peek-app/convex/nostr/projection'

const RELAY_URL = 'http://localhost:3000'
let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

function person() {
  const secretKeyHex = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
  const identity = { secretKeyHex, pubkey: publicKeyFromSecret(secretKeyHex) }
  return { identity, store: new Store(new Relay(RELAY_URL, identity), identity) }
}

async function main() {
  // ── Linear-lite's side ────────────────────────────────────────────────────
  const ana = person()
  const folder = randomUUID()
  await ana.store.ensureFolder(folder, `x-${folder.slice(0, 8)}`)
  await ana.store.recommendHandler(RELAY_URL)

  const project = await ana.store.createProject({
    folder,
    title: 'Payment integration',
    description: 'Stripe Checkout for workspace billing — redirect flow, no custom card form.',
  })
  const issue = await ana.store.createIssue({
    folder,
    title: 'Billing entry + add payment method',
    description: 'Entry point in settings, plus the empty-state when no card is on file.',
    projectAddr: project.addr,
    ref: 'PAY-1',
  })
  await ana.store.setField({ folder, target: issue.addr, field: 'status', value: 'in_progress' })
  await ana.store.setField({ folder, target: issue.addr, field: 'assignee', value: ana.identity.pubkey })
  await ana.store.setField({ folder, target: issue.addr, field: 'status', value: 'done' })
  await ana.store.comment({ folder, target: issue.addr, body: 'Blocked on the Stripe key.' })
  await ana.store.comment({ folder, target: issue.addr, body: 'Key is in 1Password now.' })

  // ── What a user pastes into Peek ──────────────────────────────────────────
  const pasted = `Can someone look at nostr:${addrToNaddr(issue.addr, [RELAY_URL])} today?`
  console.log(`\npasted into Peek: "${pasted.slice(0, 48)}…"\n`)

  // ── Peek's side. A reader who authored none of it. ────────────────────────
  const peek = person()

  // Peek's reader has to be a MEMBER of the Folder. Objects and changes are
  // channel-scoped, so a non-member's query returns zero rows — not an error,
  // just silence, which reads exactly like "the object does not exist".
  // The manifest and the recommendation are global kinds and resolve fine
  // without membership, so the failure lands late and looks like a bad naddr.
  const { buildAddMember } = await import('/home/miky/linear-lite/lib/nostr/events')
  const { signEvent } = await import('/home/miky/linear-lite/lib/nostr/sign')
  const added = await new Relay(RELAY_URL, ana.identity).publish(
    signEvent(
      buildAddMember(ana.identity.pubkey, Date.now(), {
        channelUuid: folder,
        targetPubkey: peek.identity.pubkey,
        role: 'member',
      }),
      ana.identity.secretKeyHex,
    ),
  )
  check('Peek\'s reader is added to the Folder', added.ok, added.reason ?? '')

  const relay = new Relay(RELAY_URL, peek.identity)
  const query = (filters: Record<string, unknown>[]) => relay.query(filters)

  const { findNaddrs } = await import('/home/miky/peek-app/convex/nostr/nip19')
  const [found] = findNaddrs(pasted)
  check('Peek finds the reference in the message body', !!found)

  const widget = await resolveForeignObject(found, query)
  check('Peek resolves it into a widget', !!widget)
  if (!widget) {
    console.log(`\n${failures} FAILED`)
    process.exit(1)
  }

  console.log(`\n  app        ${widget.appName}`)
  console.log(`  widget     ${widget.widget}`)
  console.log(`  via        ${widget.viaRecommendation ? "the author's NIP-89 recommendation" : 'a #k guess'}`)
  for (const [name, slot] of Object.entries(widget.slots)) {
    console.log(`  ${name.padEnd(10)} ${slot.value}${slot.colour ? `  [${slot.colour}]` : ''}`)
  }
  for (const m of widget.meta) {
    console.log(`  meta       ${m.label ? `${m.label}: ` : ''}${m.isPubkey ? `${m.value.slice(0, 8)}…` : m.value}`)
  }
  for (const c of widget.comments) console.log(`  comment    ${c.author.slice(0, 8)}… "${c.body}"`)
  console.log('')

  check('  it used the author\'s recommendation, not a guess', widget.viaRecommendation)
  check('  the app names itself', widget.appName === 'Linear-lite', widget.appName)
  check('  widget type comes from the manifest', widget.widget === 'row', widget.widget)
  check('  title', widget.slots.title?.value === 'Billing entry + add payment method')
  check('  subtitle is truncated per the manifest', (widget.slots.subtitle?.value.length ?? 0) <= 121)

  // The one that matters: status is NOT on the issue event. Peek got it by
  // folding change events using a rule it read from the manifest.
  check('  STATUS IS FOLDED, and it is the last write', widget.slots.status?.value === 'Done', widget.slots.status?.value)
  check('  …rendered through the declared vocabulary', widget.slots.status?.colour === 'green', widget.slots.status?.colour)
  check('  assignee resolved as a person, not hex', widget.meta.some((m) => m.label === 'Assignee' && m.isPubkey))
  check('  the display ref came through', widget.meta.some((m) => m.value === 'PAY-1'))
  check('  both comments, oldest first', widget.comments.length === 2 && widget.comments[0].body.startsWith('Blocked'), `${widget.comments.length}`)

  // The project is a different widget type from the same manifest.
  const card = await resolveForeignObject(addrToNaddr(project.addr, [RELAY_URL]), query)
  check('the project renders as a different widget', card?.widget === 'card', card?.widget)
  check('  with its own vocabulary default', card?.slots.status?.value === 'Planned', card?.slots.status?.value)

  // Peek must not invent a rendering for a kind nobody declared.
  const unknown = await resolveForeignObject(addrToNaddr(`31337:${ana.identity.pubkey}:nope`), query)
  check('an undeclared kind resolves to nothing', unknown === null)

  console.log(failures === 0 ? '\nPeek rendered Linear-lite from the manifest alone.' : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
