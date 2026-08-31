/**
 * Peek acts on a Linear-lite object, and Linear-lite sees it.
 *
 * The read side proved Peek can render another app's object from a manifest.
 * This proves the write side, which is the harder claim: Peek changes an issue's
 * status, and **Linear-lite's own fold** — not Peek's — reports the new value.
 *
 * The event is built by Peek's `buildActionEvent`, which reads the kind, the tag
 * names, the field and the legal values off the manifest. No Linear-lite import
 * appears below except the ones standing in for "the other app's code", clearly
 * marked.
 *
 *   npx tsx docs/buzz-compat/verify-foreign-action.ts
 */

// ── The other app. Stands in for a user clicking around in Linear-lite. ──────
import { Relay } from '/home/miky/linear-lite/lib/nostr/relay'
import { publicKeyFromSecret, signEvent as llSign } from '/home/miky/linear-lite/lib/nostr/sign'
import { Store } from '/home/miky/linear-lite/src/store'
import { foldFolder } from '/home/miky/linear-lite/src/fold'
import { addrToNaddr } from '/home/miky/linear-lite/lib/nostr/nip19'

// ── Peek's code. This is what is under test. ─────────────────────────────────
import { buildActionEvent, resolveForeignObject, resolveManifest } from '../../interop/projection'
import { decodeNaddr, pointerToAddress } from '../../convex/nostr/nip19'

const RELAY_URL = process.env.RELAY_URL ?? 'http://localhost:3000'

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

function person() {
  const secretKeyHex = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
  return { secretKeyHex, pubkey: publicKeyFromSecret(secretKeyHex) }
}

async function main() {
  // ── Ana, in Linear-lite ───────────────────────────────────────────────────
  const ana = person()
  const store = new Store(new Relay(RELAY_URL, ana), ana)
  await store.recommendHandler(RELAY_URL)
  const project = await store.createProject({ title: 'Payment integration' })
  // The project's Folder — where the issue and every change to it live. Peek is
  // never handed this value; it reads it off the object's `h`.
  const folder = project.folder
  const issue = await store.createIssue({
    folder,
    title: 'Billing entry + add payment method',
    projectAddr: project.addr,
    ref: 'PAY-1',
  })
  const naddr = addrToNaddr(issue.addr, [RELAY_URL])
  console.log(`Ana  ${ana.pubkey.slice(0, 12)}…  created PAY-1\n`)

  // ── Priya, in Peek. Different person, different app. ──────────────────────
  const priya = person()
  const relay = new Relay(RELAY_URL, priya)
  const query = (filters: Record<string, unknown>[]) => relay.query(filters)

  const widget = await resolveForeignObject(naddr, query)
  check('Peek renders the issue', !!widget && !widget.unreachable)
  check(
    '  …having worked out the Folder from the object alone',
    widget?.folder === folder,
    widget?.folder?.slice(0, 8),
  )
  check('  …and it starts as Todo', widget?.slots.status?.value === 'Todo', widget?.slots.status?.value)

  // The actions come off the manifest, not out of Peek.
  const actions = widget?.actions ?? []
  console.log(`\nactions the manifest offers Peek:`)
  for (const a of actions) {
    console.log(`  ${a.id.padEnd(18)} ${a.control.padEnd(7)} ${a.options?.map((o) => o.value).join('/') ?? ''}`)
  }
  console.log('')
  check('Peek is offered a status control', actions.some((a) => a.id === 'set-issue-status' && a.control === 'select'))
  check('  …with the owner\'s vocabulary', actions.find((a) => a.id === 'set-issue-status')?.options?.length === 4)
  check('Peek is offered an assignee control', actions.some((a) => a.id === 'assign-issue' && a.control === 'pubkey'))
  check(
    'an object-creating action is NOT offered as a control',
    !actions.some((a) => a.id === 'add-issue'),
    'add-issue needs a form, not a button',
  )

  // ── Priya changes the status, from Peek ───────────────────────────────────
  const pointer = decodeNaddr(naddr)
  const resolved = await resolveManifest(pointer, query)
  const manifest = resolved!.manifest

  async function act(actionId: string, value: string) {
    const built = buildActionEvent({
      manifest,
      kind: pointer.kind,
      address: pointerToAddress(pointer),
      objectAuthor: pointer.pubkey,
      folder: widget!.folder!,
      actionId,
      value,
      pubkey: priya.pubkey,
      createdAtMs: Date.now(),
    })
    if (typeof built === 'string') return { ok: false, reason: built }
    return relay.publish(llSign(built as never, priya.secretKeyHex))
  }

  // A value outside the declared vocabulary must be refused before it is
  // published. The owning app cannot enforce this, so the consumer must.
  const bogus = await act('set-issue-status', 'ushipped')
  check('a value outside the vocabulary is refused', !bogus.ok, bogus.reason)

  const wrongKind = await act('add-issue', 'x')
  check('an action Peek cannot render is still refused', !wrongKind.ok, wrongKind.reason)

  const inProgress = await act('set-issue-status', 'in_progress')
  check('Peek publishes a status change', inProgress.ok, inProgress.reason ?? '')
  const assigned = await act('assign-issue', priya.pubkey)
  check('Peek publishes an assignment', assigned.ok, assigned.reason ?? '')
  const done = await act('set-issue-status', 'done')
  check('Peek publishes a second status change', done.ok, done.reason ?? '')
  const commented = await act('comment', 'Shipped from Peek.')
  check('Peek publishes a comment as a kind:9 conversation', commented.ok, commented.reason ?? '')

  // ── The claim: LINEAR-LITE's fold sees Peek's writes ──────────────────────
  const state = foldFolder(await store.rawFolders([folder]))
  const folded = state.issues.find((i) => i.addr === issue.addr)

  console.log('')
  check('Linear-lite folds the status Peek set', folded?.status === 'done', `status=${folded?.status}`)
  check('  …and attributes it to PRIYA, not Ana', folded?.fields.status?.by === priya.pubkey, `by ${folded?.fields.status?.by?.slice(0, 8)}…`)
  check('  …assignee too', folded?.assignee === priya.pubkey)
  check('Ana\'s root event is untouched', folded?.title === 'Billing entry + add payment method' && folded?.author === ana.pubkey)
  check('Ana\'s activity feed shows Peek\'s changes', state.activity.length === 3, `${state.activity.length} entries`)
  check(
    '  …in the order Peek made them',
    state.activity.map((c) => c.value === priya.pubkey ? 'assignee' : c.value).join(',') === 'in_progress,assignee,done',
    state.activity.map((c) => c.field).join(' → '),
  )
  // The payoff of pointing the manifest's comment action at kind:9: Peek's
  // comment is not a note only Linear-lite renders, it is a conversation in the
  // Folder — which is the same thing the Peek topic shows.
  const { conversationsAbout } = await import('/home/miky/linear-lite/src/fold')
  const threads = conversationsAbout(state.conversations, issue.addr)
  check('Peek\'s comment starts a conversation on Ana\'s issue',
    threads.some((c) => c.root.body === 'Shipped from Peek.'), `${threads.length} thread(s)`)
  check('  …and it is a root message, so Peek shows it in the topic too',
    threads[0]?.root.rootId === undefined || threads[0]?.root.id === threads[0]?.id)

  // And Peek re-renders its own write.
  const after = await resolveForeignObject(naddr, query)
  check('Peek re-renders as Done', after?.slots.status?.value === 'Done', after?.slots.status?.value)

  console.log(
    failures === 0
      ? '\nPeek changed Linear-lite\'s issue. Neither app imports the other.'
      : `\n${failures} check(s) FAILED.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
