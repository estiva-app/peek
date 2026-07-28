/**
 * Rendering another app's objects from its published manifest — the pure part.
 *
 * Split from `foreign.ts` so it can be exercised against a live relay without a
 * Convex deployment: everything here takes a `query` function rather than
 * reaching for one. `foreign.ts` supplies the authenticated bridge; a test
 * supplies its own.
 *
 * **Nothing in this file knows what Linear-lite is.** No kind number, no field
 * name, no status vocabulary is hardcoded — every one comes off the NIP-89
 * manifest at runtime. If that stops being true the demo stops proving
 * anything: it becomes an integration written against one app, which is the
 * thing the whole exercise argues against.
 */
import { decodeNaddr, pointerToAddress, type AddressPointer } from './nip19'
import type { SignedEvent } from './events'

/** Query the relay. Returns matching events; shape mirrors the HTTP bridge. */
export type QueryFn = (filters: Record<string, unknown>[]) => Promise<SignedEvent[]>

/** An unsigned Nostr event, ready for `sign.ts`. */
export interface UnsignedActionEvent {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

/** NIP-89 kinds. These two are protocol, not app-specific. */
const KIND_HANDLER_RECOMMENDATION = 31989
const KIND_HANDLER_INFORMATION = 31990
/** NIP-22 comments. Also protocol — no app owns this kind. */
const KIND_COMMENT = 1111

/** How the owning app says its records should be read. */
interface RecordsRule {
  changeKind: number
  targetTag: string
  fieldTag: string
  valueTag: string
  order: string[]
  rule: string
}

interface SlotSpec {
  tag?: string
  field?: string
  fold?: string
  map?: string
  as?: string
  label?: string
  truncate?: number
  default?: string
}

/** An action the owning app says other apps may perform. */
export interface ManifestAction {
  id: string
  label: string
  /** Kind(s) this applies to, as strings. */
  appliesTo: string | string[]
  emits: { kind: number; field?: string; scope?: string }
  input?: { type: string; enum?: string }
}

/**
 * An action resolved into something a renderer can draw without re-reading the
 * manifest.
 *
 * The interpretation happens here rather than in the component on purpose: the
 * widget should not have to know that `input.enum` names a vocabulary, or that
 * `as: "pubkey"` means "a person". Those are manifest semantics, and keeping
 * them on this side is what lets the React component stay a dumb renderer that
 * would work for any app.
 */
export interface ResolvedAction {
  id: string
  label: string
  control: 'select' | 'pubkey' | 'text'
  /** For `select`: the declared vocabulary, already looked up. */
  options?: { value: string; label: string; colour?: string }[]
  /** The value this field holds right now, so a control can show it. */
  current?: string
  field?: string
}

interface Manifest {
  name?: string
  about?: string
  actions?: ManifestAction[]
  records?: RecordsRule
  projections?: Record<string, { widget: string; slots: Record<string, SlotSpec | SlotSpec[]> }>
  vocabularies?: Record<string, { value: string; label: string; colour: string }[]>
}

/** Actions declared for this kind, resolved against the vocabularies. */
function resolveActions(
  manifest: Manifest,
  kind: number,
  folded: Record<string, { value: string }>,
): ResolvedAction[] {
  const applies = (action: ManifestAction) =>
    (Array.isArray(action.appliesTo) ? action.appliesTo : [action.appliesTo]).includes(String(kind))

  const out: ResolvedAction[] = []
  for (const action of manifest.actions ?? []) {
    if (!applies(action)) continue
    // Only field-setting changes and comments are renderable today. An action
    // that creates a whole new object (`add-issue`) needs a form and a parent,
    // so it is skipped rather than drawn as a control that cannot work.
    const isChange = !!action.emits.field
    const isComment = action.emits.scope === 'address'
    if (!isChange && !isComment) continue

    const vocab = action.input?.enum ? manifest.vocabularies?.[action.input.enum] : undefined
    out.push({
      id: action.id,
      label: action.label,
      control: vocab ? 'select' : action.input?.type === 'pubkey' ? 'pubkey' : 'text',
      options: vocab?.map((v) => ({ value: v.value, label: v.label, colour: v.colour })),
      current: action.emits.field ? folded[action.emits.field]?.value : undefined,
      field: action.emits.field,
    })
  }
  return out
}

const tagValue = (e: SignedEvent, name: string) => e.tags.find((t) => t[0] === name)?.[1]

/**
 * Which manifest wins when several claim the same kind.
 *
 * A `#k` query is NIP-89's discovery mechanism and it returns every handler for
 * a kind, ranked by nothing. So the object's **author's** kind:31989
 * recommendation is consulted first: the person who created the object is the
 * one entitled to say which app renders it, and that is a trust anchor Peek
 * already has rather than a value someone has to paste into a config file.
 *
 * The `#k` fallback exists so an object whose author never published a
 * recommendation still renders, rather than failing closed on a missing
 * preference. When it fires, `viaRecommendation` is false and the caller can
 * say so in the UI — "we guessed" and "we were told" should not look identical.
 */
/**
 * NIP-89's `web` tag: how to open one of these objects in the app that owns it.
 *
 * `["web", "https://host/#/o/<bech32>", "naddr"]` — the consumer substitutes the
 * entity it is holding. Read off the *event* rather than the manifest content,
 * because that is where NIP-89 puts it.
 *
 * Returns undefined when no usable template was published, which is an ordinary
 * state rather than an error: an app may render objects it has nowhere to open.
 */
function webTemplate(event: SignedEvent, entity: string): string | undefined {
  for (const tag of event.tags) {
    if (tag[0] !== 'web' || !tag[1]) continue
    // The third element names the entity type; NIP-89 permits omitting it, in
    // which case the template applies to whatever we are holding.
    if (tag[2] && tag[2] !== entity) continue
    if (!tag[1].includes('<bech32>')) continue
    return tag[1]
  }
  return undefined
}

export async function resolveManifest(
  pointer: AddressPointer,
  query: QueryFn,
): Promise<{
  manifest: Manifest
  address: string
  viaRecommendation: boolean
  /** NIP-89 `web` template, `<bech32>` not yet substituted. */
  webTemplate?: string
} | null> {
  const parse = (event: SignedEvent) => {
    try {
      return JSON.parse(event.content) as Manifest
    } catch {
      return null
    }
  }
  const addressOf = (event: SignedEvent) =>
    `${event.kind}:${event.pubkey}:${tagValue(event, 'd') ?? ''}`

  const recommended = await query(
    [
      {
        kinds: [KIND_HANDLER_RECOMMENDATION],
        authors: [pointer.pubkey],
        '#d': [String(pointer.kind)],
        limit: 1,
      },
    ],
  )
  const manifestAddr = recommended[0]?.tags.find((t) => t[0] === 'a')?.[1]
  if (manifestAddr) {
    const [kind, pubkey, ...rest] = manifestAddr.split(':')
    const found = await query([
      { kinds: [Number(kind)], authors: [pubkey], '#d': [rest.join(':')], limit: 1 },
    ])
    const manifest = found[0] ? parse(found[0]) : null
    if (manifest) {
      return {
        manifest,
        address: manifestAddr,
        viaRecommendation: true,
        webTemplate: webTemplate(found[0], 'naddr'),
      }
    }
  }

  const claimed = await query([
    { kinds: [KIND_HANDLER_INFORMATION], '#k': [String(pointer.kind)], limit: 20 },
  ])
  // Newest wins among unrecommended candidates. Arbitrary, and honest about it:
  // there is no principled ranking without a recommendation, which is exactly
  // why the recommendation exists.
  const newest = [...claimed].sort((a, b) => b.created_at - a.created_at)
  for (const candidate of newest) {
    const manifest = parse(candidate)
    if (manifest?.projections?.[String(pointer.kind)]) {
      return {
        manifest,
        address: addressOf(candidate),
        viaRecommendation: false,
        webTemplate: webTemplate(candidate, 'naddr'),
      }
    }
  }
  return null
}

/**
 * Ordering key for an append-only event, per the manifest's `records.order`.
 *
 * The manifest declares `["ts", "created_at", "id"]` and, crucially, the
 * condition under which `ts` may be believed: only when it agrees with
 * `created_at` to the second. `created_at` has one-second resolution and the
 * relay validates it, so a `ts` pinned inside that second inherits that
 * validation and can only refine ordering *within* it.
 *
 * Peek enforces that bound itself rather than trusting the writer. Under the
 * honour-system model nothing validates these events (RFC_UPDATES.md §3), so a
 * buggy or pushy client claiming a far-future `ts` would otherwise win every
 * fold forever — in Peek's rendering as much as in the owning app's.
 */
function orderingMs(event: SignedEvent): number {
  const raw = Number.parseInt(tagValue(event, 'ts') ?? '', 10)
  if (Number.isFinite(raw) && Math.abs(Math.floor(raw / 1000) - event.created_at) <= 1) return raw
  return event.created_at * 1000
}

/** Total order, oldest first. Ties break on the lower event id (NIP-01's rule). */
function byOrder(a: SignedEvent, b: SignedEvent): number {
  const [at, bt] = [orderingMs(a), orderingMs(b)]
  if (at !== bt) return at - bt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Replay change events into current field values. Last write wins per field. */
function foldChanges(changes: SignedEvent[], rule: RecordsRule) {
  const fields: Record<string, { value: string; by: string; at: number }> = {}
  for (const change of [...changes].sort(byOrder)) {
    const field = tagValue(change, rule.fieldTag)
    const value = tagValue(change, rule.valueTag)
    if (!field || value === undefined) continue // a partial change sets nothing
    fields[field] = { value, by: change.pubkey, at: change.created_at }
  }
  return fields
}

function truncate(text: string, limit?: number) {
  if (!limit || text.length <= limit) return text
  return `${text.slice(0, limit).trimEnd()}…`
}

/** A slot, resolved to something a renderer can put on screen. */
export interface ResolvedSlot {
  label?: string
  value: string
  /** Set when the value came from a vocabulary — the consumer picks the colour. */
  colour?: string
  /** True when the value is a pubkey and should be shown as a person. */
  isPubkey?: boolean
}

function resolveSlot(
  spec: SlotSpec,
  root: SignedEvent,
  folded: Record<string, { value: string }>,
  manifest: Manifest,
): ResolvedSlot | null {
  let raw: string | undefined
  if (spec.tag) raw = tagValue(root, spec.tag)
  else if (spec.field === 'content') raw = root.content
  else if (spec.fold) raw = folded[spec.fold]?.value ?? spec.default

  if (raw === undefined || raw === '') return null

  let value = truncate(raw, spec.truncate)
  let colour: string | undefined
  if (spec.map) {
    const entry = manifest.vocabularies?.[spec.map]?.find((v) => v.value === raw)
    // A value outside the declared vocabulary is shown as-is rather than
    // dropped. Another app may have written it, and silently rendering nothing
    // would hide exactly the corruption the honour system permits.
    value = entry?.label ?? raw
    colour = entry?.colour ?? 'muted'
  }
  return { label: spec.label, value, colour, isPubkey: spec.as === 'pubkey' }
}

/** Everything the frontend needs to draw the widget. */
export interface ForeignObject {
  address: string
  kind: number
  widget: string
  appName?: string
  /** Named single slots: title, subtitle, status. */
  slots: Record<string, ResolvedSlot>
  /** Repeating slots, e.g. `meta`. */
  meta: ResolvedSlot[]
  comments: { id: string; author: string; body: string; createdAt: number }[]
  /**
   * The Folder this object lives in, from the root event's `h` tag.
   *
   * Needed to *write*: a change event carries the same `h`, and without it the
   * relay rejects the write outright. Reading it off the object rather than
   * asking the user is the difference between an action that works and a form
   * with a "Folder id" box in it.
   */
  folder?: string
  /**
   * Where to open this object in the app that owns it, from NIP-89's `web` tag.
   *
   * The return leg of the roundtrip. Without it a reference is a read-only
   * snapshot: Peek can render a Linear-lite issue and change its status, and
   * getting back to the issue itself means alt-tabbing and hunting for a row.
   *
   * Absent when the owning app published no template — the widget simply does
   * not offer the link, rather than guessing a URL.
   */
  openUrl?: string
  /** What the owning app says we may do to this object. */
  actions: ResolvedAction[]
  /** False when no author recommendation existed and a handler was guessed. */
  viaRecommendation: boolean
  /**
   * Set when the manifest resolved but the object itself did not.
   *
   * Almost always a permission problem rather than a missing object, and worth
   * distinguishing because the relay makes them look identical. Objects and
   * change events are channel-scoped, so a reader who is not a member of the
   * Folder gets zero rows — no error, just silence. The manifest and the
   * recommendation are global kinds and resolve fine without membership, so the
   * failure lands late and presents as a broken reference. Telling the user
   * "you may not have access to this Folder" is a far better guess than
   * rendering nothing.
   */
  unreachable?: boolean
}


/**
 * Resolve a `nostr:naddr…` into a renderable widget.
 *
 * Returns `null` rather than throwing when the object cannot be rendered — an
 * unresolvable reference in a chat message should degrade to plain text, not
 * break the message around it.
 */
export async function resolveForeignObject(
  naddr: string,
  query: QueryFn,
): Promise<ForeignObject | null> {
  let pointer: AddressPointer
  try {
    pointer = decodeNaddr(naddr)
  } catch {
    return null
  }
  const address = pointerToAddress(pointer)

  const resolved = await resolveManifest(pointer, query)
  if (!resolved) return null
  const { manifest, viaRecommendation } = resolved
  // Substituted here rather than in the component: `<bech32>` is a NIP-89
  // detail, and the widget's job is to draw a link, not to know the spec.
  const openUrl = resolved.webTemplate?.replace('<bech32>', naddr.replace(/^nostr:/, ''))

  const projection = manifest.projections?.[String(pointer.kind)]
  const records = manifest.records
  if (!projection || !records) return null

  // One round trip for the root, its changes and its comments. `#a` on both the
  // change and the comment kind, because both point at the object by *address*
  // rather than by event id — which is what makes them survive the author
  // replacing the root event.
  const events = await query([
    { kinds: [pointer.kind], authors: [pointer.pubkey], '#d': [pointer.identifier], limit: 1 },
    { kinds: [records.changeKind], '#a': [address], limit: 500 },
    { kinds: [KIND_COMMENT], '#a': [address], limit: 200 },
  ])

  const root = events.find(
    (e) => e.kind === pointer.kind && tagValue(e, 'd') === pointer.identifier,
  )
  if (!root) {
    // We know which app owns this and how it would be drawn; we just cannot see
    // the object. Say so rather than returning null and looking like a typo.
    return {
      address,
      kind: pointer.kind,
      widget: projection.widget,
      appName: manifest.name,
      slots: {},
      meta: [],
      comments: [],
      actions: [],
      viaRecommendation,
      // Offered even here. "You cannot see this object" is exactly when
      // somebody wants to open it in the app that can.
      openUrl,
      unreachable: true,
    }
  }

  const folded = foldChanges(
    events.filter(
      (e) => e.kind === records.changeKind && tagValue(e, records.targetTag) === address,
    ),
    records,
  )

  const slots: Record<string, ResolvedSlot> = {}
  const meta: ResolvedSlot[] = []
  for (const [name, spec] of Object.entries(projection.slots)) {
    if (Array.isArray(spec)) {
      for (const one of spec) {
        const value = resolveSlot(one, root, folded, manifest)
        if (value) meta.push(value)
      }
    } else {
      const value = resolveSlot(spec, root, folded, manifest)
      if (value) slots[name] = value
    }
  }

  const comments = events
    .filter((e) => e.kind === KIND_COMMENT)
    .sort(byOrder)
    .map((e) => ({ id: e.id, author: e.pubkey, body: e.content, createdAt: e.created_at }))

  return {
    address,
    kind: pointer.kind,
    widget: projection.widget,
    appName: manifest.name,
    slots,
    meta,
    comments,
    folder: tagValue(root, 'h'),
    openUrl,
    actions: resolveActions(manifest, pointer.kind, folded),
    viaRecommendation,
  }
}

/**
 * Build the event that performs a manifest-declared action.
 *
 * Pure, and separate from the Convex action for the same reason `projection.ts`
 * is separate from `foreign.ts`: this is the part worth testing against a live
 * relay, and it must not need a deployment or a signed-in session to run.
 *
 * Returns a string on refusal rather than throwing — every failure here is
 * something a user should read.
 */
export function buildActionEvent(args: {
  manifest: { records?: RecordsRule; actions?: ManifestAction[]; vocabularies?: Manifest['vocabularies'] }
  kind: number
  /** Address of the object being acted on. */
  address: string
  /** Author of the object — needed for NIP-22's `P`/`p` tags. */
  objectAuthor: string
  folder: string
  actionId: string
  value: string
  pubkey: string
  createdAtMs: number
}): UnsignedActionEvent | string {
  const { manifest, kind, address, folder, actionId, value } = args
  const records = manifest.records
  const declared = manifest.actions?.find((a) => a.id === actionId)
  if (!records) return 'That app does not say how its records are written.'
  if (!declared) return `This app does not offer "${actionId}".`

  const appliesTo = Array.isArray(declared.appliesTo) ? declared.appliesTo : [declared.appliesTo]
  if (!appliesTo.includes(String(kind))) {
    return `"${declared.label}" does not apply to a kind ${kind}.`
  }

  // Validate against the manifest's own vocabulary. The owning app cannot
  // enforce this — anyone can publish anything (RFC_UPDATES.md §3) — so a
  // consumer that skips the check is the one putting junk in the shared record.
  // Checking here is Peek keeping its side of the honour system.
  if (declared.input?.enum) {
    const vocab = manifest.vocabularies?.[declared.input.enum] ?? []
    if (!vocab.some((entry) => entry.value === value)) {
      return `"${value}" is not one of ${vocab.map((e) => e.value).join(', ')}.`
    }
  }

  const tags: string[][] = declared.emits.field
    ? [
        [records.targetTag, address],
        [records.fieldTag, declared.emits.field],
        [records.valueTag, value],
        ['h', folder],
      ]
    : // NIP-22 comment. Built from the ratified NIP rather than from the
      // manifest, which is legitimate precisely because no app owns kind:1111 —
      // the same reason the owning app uses it. Uppercase tags name the thread
      // root, lowercase the immediate parent.
      [
        ['A', address],
        ['K', String(kind)],
        ['P', args.objectAuthor],
        ['a', address],
        ['k', String(kind)],
        ['p', args.objectAuthor],
        ['h', folder],
      ]

  // The manifest told us how it orders events; write events that can be ordered.
  // Without `ts`, a change from here and one from the owning app in the same
  // second would be separated by event id — arbitrarily, and differently
  // depending on which app you asked (FRICTION.md A6).
  if (records.order?.includes('ts')) tags.push(['ts', String(args.createdAtMs)])

  return {
    pubkey: args.pubkey,
    created_at: Math.floor(args.createdAtMs / 1000),
    kind: declared.emits.kind,
    tags,
    content: declared.emits.field ? '' : value,
  }
}
