/**
 * The launcher's app and action registry — manifest-shaped, deliberately.
 *
 * Everything the Cmd+K launcher lists is declared here in the same vocabulary
 * an app's NIP-89 manifest uses (`interop/projection.ts` `ManifestAction`,
 * RFC 0.4 §13.4): an action is `{ id, label, appliesTo, emits, input }`, and a
 * form is drawn FROM that declaration rather than hand-built per app. That is
 * the point of the exercise — the Intelligence runtime will hand the launcher
 * real manifests, and swapping this constant for a live read must not reshape
 * any UI.
 *
 * Two kinds of honesty are kept apart:
 *
 * - `declaredToday: true` marks what the owning app's live manifest actually
 *   declares right now (Ship's `add-issue` declares exactly `{ title }`).
 * - Everything else is this design's PROPOSAL for what the manifest should
 *   grow. Peek's own manifest deliberately declares no actions yet
 *   (`src/nostr/manifest.ts` says why), so both Peek actions are proposals.
 *
 * Submitting a form publishes for real where the live manifest declares the
 * action (PEE-1) and leaves its reference in the composer (PEE-2) — see
 * `CommandLauncher`'s `submitAction`. Rows that are only proposals stay inert,
 * because publishing a guess at another app's object is what the honour system
 * forbids.
 */

export interface VocabOption {
  value: string
  label: string
}

/**
 * How one field is drawn. The names mirror the manifest's `input` vocabulary:
 * `string`/`text` are `type: 'string'` (single line vs prose), `enum` is
 * `enum: '<vocabulary>'`, `pubkey` is `type: 'pubkey'` (`people` is its plural — invitees), and `parent` is the
 * field implied by `emits.toAddressOf: 'self'` — the object this creation
 * hangs under, which is the half of "needs a form and a parent" that made
 * object-creating actions unrenderable before (RFC 0.4 §13.4).
 */
export type FormControl = 'string' | 'text' | 'enum' | 'pubkey' | 'people' | 'parent'

export interface FormField {
  key: string
  label: string
  control: FormControl
  required?: boolean
  placeholder?: string
  /** For `enum`: which of the app's vocabularies feeds the select. */
  vocabulary?: string
  /** For `enum`: the value preselected before anyone chooses. */
  defaultValue?: string
  /** For `parent`: the noun the picker offers ("project", "topic"). */
  parentNoun?: string
  /** For `parent`: the mock object list v1 offers. A live runtime replaces
   *  this with a relay query; `CommandLauncher` already overrides it for
   *  Peek topics, which the app can list without any new machinery. */
  parentOptions?: VocabOption[]
  /** Declared by the owning app's manifest today, vs proposed by this design. */
  declaredToday?: boolean
}

export interface LauncherAction {
  id: string
  label: string
  /** Verbatim `ManifestAction` halves where the declaration exists today,
   *  so the runtime can key on them unchanged. */
  appliesTo?: string
  emits?: Record<string, unknown>
  fields: FormField[]
  submitLabel: string
  /** The whole action exists in the live manifest (vs proposed). */
  declaredToday?: boolean
  /**
   * The object this action changes, as an address (PEE-3).
   *
   * Set only for a **field-setting** action, where the target already exists
   * and was chosen when the row was — an object-creating action has no target,
   * it has a parent, and that travels as a form field the person fills in.
   * Its presence is what tells `submitAction` to send a scalar to an existing
   * object rather than a property bag to a parent.
   */
  target?: string
  /** What the target is called, for the row and the form's chip. */
  targetLabel?: string
}

export interface LauncherApp {
  /**
   * Any app, not one of two.
   *
   * Widened by INT-5, whose done-when is that this works for an app added
   * after it shipped — a union of the apps that existed when it was written is
   * a type-level assertion that no others will. The two rendering helpers that
   * still compare against `'peek'` fall back to the other mark, which is a gap
   * a third app would fill by bringing its own; it is a registry concern, not
   * a reason to keep the union.
   */
  id: string
  label: string
  description: string
  /** Input placeholder while this app is the active scope. */
  placeholder: string
  /** Same shape the manifest publishes: named option lists used by `enum`
   *  fields. Ship's are verbatim from `ship/src/kinds.ts`. */
  vocabularies: Record<string, VocabOption[]>
  actions: LauncherAction[]
  /**
   * The kind whose records a new object hangs under, if this app creates
   * anything — what `creatableUnder` is asked for.
   *
   * **The one app-specific fact discovery cannot avoid**, and it lives here
   * rather than in whatever consumes it: a projection is per kind, so finding
   * an app's manifest means querying one of its records, and something must
   * name the kind. Adding an app is then a registry entry, not a change to any
   * consumer — which is INT-5's whole test (RFC 0.4 §15: an app nobody here
   * wrote publishes a manifest, and this works for it the same day).
   *
   * Absent for an app that creates nothing readable this way, and such an app
   * is simply not probed.
   */
  parentKind?: number
}

/** Verbatim `ship/src/kinds.ts` `ISSUE_STATUSES` (values and labels). */
const SHIP_ISSUE_STATUSES: VocabOption[] = [
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Verbatim `ship/src/kinds.ts` `PROJECT_STATUSES`. */
const SHIP_PROJECT_STATUSES: VocabOption[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

/**
 * Mock projects for the parent picker, in the demo dataset's register.
 * A live runtime lists kind:30850 records instead.
 */
const MOCK_SHIP_PROJECTS: VocabOption[] = [
  { value: 'dashboard-redesign', label: 'Dashboard redesign' },
  { value: 'mobile-onboarding', label: 'Mobile onboarding' },
  { value: 'files-and-sharing', label: 'Files & sharing' },
]

const SHIP: LauncherApp = {
  id: 'ship',
  label: 'Ship',
  description: 'Projects & issues',
  placeholder: "Try 'create issue' or 'create project'...",
  // Its projects. Nothing outside this literal knows that number.
  parentKind: 30850,
  vocabularies: {
    issueStatuses: SHIP_ISSUE_STATUSES,
    statuses: SHIP_PROJECT_STATUSES,
  },
  actions: [
    {
      // Ship's manifest declares this action today (`ship/src/manifest.ts`),
      // with an input of exactly `{ title }`. The launcher was built because
      // the consumer runtime skips it: an object-creating action needs a form.
      id: 'add-issue',
      label: 'Create issue',
      appliesTo: '30850',
      emits: { kind: 30851, setTag: 'a', toAddressOf: 'self' },
      submitLabel: 'Create issue',
      declaredToday: true,
      fields: [
        {
          key: 'title',
          label: 'Title',
          control: 'string',
          required: true,
          placeholder: 'Issue title',
          declaredToday: true,
        },
        {
          key: 'project',
          label: 'Project',
          control: 'parent',
          required: true,
          parentNoun: 'project',
          parentOptions: MOCK_SHIP_PROJECTS,
          // Not a manifest property: the parent comes from
          // `emits.toAddressOf: 'self'`, which is why it is required.
          declaredToday: true,
        },
        {
          key: 'status',
          label: 'Status',
          control: 'enum',
          vocabulary: 'issueStatuses',
          defaultValue: 'todo',
        },
        {
          key: 'assignee',
          label: 'Assignee',
          control: 'pubkey',
          placeholder: 'Search people...',
        },
      ],
    },
    {
      // Proposed whole: Ship declares no `add-project` yet. Same shape as
      // `add-issue` so declaring it is a manifest line, not a UI change.
      id: 'add-project',
      label: 'Create project',
      emits: { kind: 30850 },
      submitLabel: 'Create project',
      fields: [
        {
          key: 'title',
          label: 'Name',
          control: 'string',
          required: true,
          placeholder: 'New project title',
        },
        {
          key: 'status',
          label: 'Status',
          control: 'enum',
          vocabulary: 'statuses',
          defaultValue: 'planned',
        },
        {
          key: 'lead',
          label: 'Lead',
          control: 'pubkey',
          placeholder: 'Search people...',
        },
      ],
    },
  ],
}

const PEEK: LauncherApp = {
  id: 'peek',
  label: 'Peek',
  description: 'Topics & conversations',
  placeholder: "Try 'start a conversation' or 'create topic'...",
  vocabularies: {},
  actions: [
    {
      // Proposed: Peek's manifest declares no actions yet — a reply names an
      // event id and the action vocabulary can only name a parent address
      // (`src/nostr/manifest.ts`). STARTING a conversation is the case that
      // fits the existing vocabulary: a kind:9 root under a topic's Folder.
      id: 'say',
      label: 'Start a conversation',
      emits: { kind: 9, toAddressOf: 'self' },
      submitLabel: 'Start conversation',
      fields: [
        {
          key: 'topic',
          label: 'Topic',
          control: 'parent',
          required: true,
          parentNoun: 'topic',
          // Overridden with the live topic list by `CommandLauncher` —
          // Peek can list its own topics without any new machinery.
          parentOptions: [],
        },
        {
          key: 'message',
          label: 'Message',
          control: 'text',
          required: true,
          placeholder: 'Start a new conversation...',
        },
      ],
    },
    {
      // Mirrors Peek's own Start topic dialog (CreateTopicDialog.tsx) —
      // Title and Invite people, no description field there and none here
      // (Katerina 2026-08-31).
      id: 'create-topic',
      label: 'Create a topic',
      emits: { kind: 9007 },
      submitLabel: 'Create topic',
      fields: [
        {
          key: 'title',
          label: 'Title',
          control: 'string',
          required: true,
          placeholder: "What's this topic about?",
        },
        {
          key: 'invitees',
          label: 'Invite people',
          control: 'people',
          placeholder: 'Search people...',
        },
      ],
    },
  ],
}

/** Order matters: Ship first, matching the ask that started this (Cmd+K forms
 *  for Ship, "and I don't see why we wouldn't expose Peek's actions as well"). */
export const LAUNCHER_APPS: LauncherApp[] = [SHIP, PEEK]
