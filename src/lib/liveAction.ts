import type { ResolvedAction } from '@estiva-app/interop'
import type { FormField, LauncherAction } from './launcherActions'

/**
 * A live manifest's action, in the shape the launcher's form already draws.
 *
 * `launcherActions.ts` set the bar for this file: *"the Intelligence runtime
 * will hand the launcher real manifests, and swapping this constant for a live
 * read must not reshape any UI."* So this converts and does nothing else —
 * `ActionFormPanel` is untouched, and the registry stays exactly where it is
 * for the actions no app declares yet.
 *
 * The conversion is small because the registry was written in the manifest's
 * own vocabulary. The parts that are not one-to-one are the interesting ones:
 *
 * - **The parent is not a property.** It comes from `emits.toAddressOf: 'self'`
 *   — surfaced by the runtime as `createsUnder` — and it is the half of "needs
 *   a form *and a parent*" that made these unrenderable. A form drawing only
 *   the declared properties would publish an orphan, so the field is synthesised
 *   here and marked required.
 * - **A label is the consumer's business.** The manifest names a property
 *   (`title`); what a person reads above the box is Peek's to choose, the same
 *   split `ForeignObjectWidget` makes for reading. Title-casing the property is
 *   a default, not a declaration.
 */

/** The synthetic field key holding the parent address. Never a manifest property. */
export const PARENT_FIELD = '__parent'

/** `title` → `Title`, `dueDate` → `Due date`. A default, replaceable by anything better. */
function labelFor(name: string): string {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

/**
 * A form control for a declared property.
 *
 * `enum` when the manifest gave the property a vocabulary — the runtime has
 * already looked it up — `pubkey` for a person, and otherwise a single-line
 * string. Prose (`text`) is deliberately not inferred: nothing in the manifest
 * distinguishes a long string from a short one, and guessing would give an app
 * a textarea it never asked for.
 */
function controlFor(field: NonNullable<ResolvedAction['fields']>[number]): FormField['control'] {
  if (field.options?.length) return 'enum'
  if (field.type === 'pubkey') return 'pubkey'
  return 'string'
}

export interface LiveActionOptions {
  /** What the parent picker calls the thing being picked — "project", "topic". */
  parentNoun?: string
  /** Overrides the title-cased property name. */
  labels?: Record<string, string>
  submitLabel?: string
}

/**
 * Returns null for anything that is not an object-creating action, which is the
 * honest answer rather than a half-drawn form: a change or a comment is one
 * control and the launcher is not where it belongs.
 */
export function launcherActionFrom(
  action: ResolvedAction,
  options: LiveActionOptions = {},
): LauncherAction | null {
  if (action.control !== 'form' || !action.fields) return null

  const fields: FormField[] = action.fields.map((field) => ({
    key: field.name,
    label: options.labels?.[field.name] ?? labelFor(field.name),
    control: controlFor(field),
    required: field.required,
    // A vocabulary the owning app declared, rendered in Peek's Select. The
    // runtime resolved it; nothing here reads the manifest again.
    ...(field.options?.length
      ? {
          vocabulary: field.name,
          defaultValue: field.options[0]?.value,
        }
      : {}),
    declaredToday: true,
  }))

  if (action.createsUnder === 'self') {
    fields.push({
      key: PARENT_FIELD,
      label: options.parentNoun ? labelFor(options.parentNoun) : 'Parent',
      control: 'parent',
      required: true,
      parentNoun: options.parentNoun ?? 'object',
      declaredToday: true,
    })
  }

  return {
    id: action.id,
    label: action.label,
    fields,
    submitLabel: options.submitLabel ?? action.label,
    declaredToday: true,
  }
}

/**
 * The vocabularies an `enum` field needs, keyed the way `ActionFormPanel` looks
 * them up — by the field's own key, since the runtime hands back options per
 * field rather than a named vocabulary the consumer has to resolve.
 */
export function vocabulariesFrom(action: ResolvedAction): Record<string, { value: string; label: string }[]> {
  const out: Record<string, { value: string; label: string }[]> = {}
  for (const field of action.fields ?? []) {
    if (field.options?.length) out[field.name] = field.options.map((o) => ({ value: o.value, label: o.label }))
  }
  return out
}

/**
 * Split a submitted form into the parent address and the properties.
 *
 * The parent travels as a field because a person picks it in the same form, and
 * it must not travel as a *property*: the runtime refuses any key the manifest
 * did not declare, which is exactly the check that keeps junk out of a shared
 * record. Dropping it here is what makes that refusal meaningful rather than
 * something the consumer has to work around.
 */
export function splitSubmission(values: Record<string, string>): {
  parent?: string
  properties: Record<string, string>
} {
  const { [PARENT_FIELD]: parent, ...properties } = values
  return { ...(parent ? { parent } : {}), properties }
}
