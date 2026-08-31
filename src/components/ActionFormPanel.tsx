import { useMemo, useState } from 'react'
import type { Person } from '@/api'
import type { FormField, LauncherAction, LauncherApp, VocabOption } from '@/lib/launcherActions'
import { Button } from './ui/Button'
import { Field } from './ui/Field'
import { PersonChipInput } from './ui/PersonChipInput'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { TextInput } from './ui/TextInput'

/**
 * A form drawn from an action declaration — the launcher's form step.
 *
 * Nothing in this file knows what a Ship issue is. It receives a
 * manifest-shaped `LauncherAction` (`lib/launcherActions.ts`) and renders one
 * control per declared field: `string` a text input, `text` a textarea,
 * `enum` Peek's Select fed from the owning app's declared vocabulary,
 * `pubkey` the person picker, `parent` a Select over the objects the new one
 * would hang under. The owner declares which fields matter; Peek renders them
 * in its own design language — the same split `ForeignObjectWidget` makes for
 * reading, applied to writing.
 *
 * This is the step RFC 0.4 §13.4 asked for: object-creating actions were
 * "declared but deliberately unrenderable" because they need a form and a
 * parent. This is the form; the `parent` control is the parent.
 *
 * There is no error state: the primary action stays DISABLED until every
 * required field is filled (Katerina 2026-08-31), the same "only offer
 * actions that can succeed" rule the launcher applies to rows.
 *
 * Submitting reports the values upward, nothing more. The Intelligence
 * runtime (Jan's projection work) is what will turn the values into a signed
 * event; its seam is the `onSubmit` callback in
 * `CommandLauncher.submitAction`.
 */

export interface ActionFormPanelProps {
  app: LauncherApp
  action: LauncherAction
  /** Live options for `parent` fields, keyed by field key. Overrides the
   *  registry's mock list — the launcher passes real topics for Peek. */
  parentOptions?: Record<string, VocabOption[]>
  /** Pre-filled values, keyed by field key (stories, and later: an agent
   *  filling the form from context instead of by hand — RFC 0.4 §13.4). */
  initialValues?: Record<string, string>
  onSubmit: (values: Record<string, string>) => void
}

export function ActionFormPanel({
  app,
  action,
  parentOptions,
  initialValues,
  onSubmit,
}: ActionFormPanelProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {}
    for (const field of action.fields) {
      const initial = initialValues?.[field.key] ?? field.defaultValue
      if (initial !== undefined) seeded[field.key] = initial
    }
    return seeded
  })
  // Chips in both cases: `pubkey` wants ONE person (capped below, flattened
  // to `person.id`), `people` keeps the whole list (ids comma-joined).
  const [people, setPeople] = useState<Record<string, Person[]>>({})

  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }))

  const valueOf = (field: FormField): string => {
    if (field.control === 'pubkey') return people[field.key]?.[0]?.id ?? ''
    if (field.control === 'people') return (people[field.key] ?? []).map((p) => p.id).join(',')
    return values[field.key] ?? ''
  }

  const incomplete = useMemo(
    () => action.fields.some((f) => f.required && valueOf(f).trim() === ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, values, people],
  )

  const submit = () => {
    if (incomplete) return
    const out: Record<string, string> = {}
    for (const field of action.fields) {
      const value = valueOf(field)
      if (value.trim() !== '') out[field.key] = value
    }
    onSubmit(out)
  }

  const optionsFor = (field: FormField): VocabOption[] => {
    if (field.control === 'enum') return app.vocabularies[field.vocabulary ?? ''] ?? []
    if (field.control === 'parent') {
      const live = parentOptions?.[field.key]
      return live && live.length > 0 ? live : (field.parentOptions ?? [])
    }
    return []
  }

  const control = (field: FormField, autoFocus: boolean) => {
    switch (field.control) {
      case 'string':
        return (
          <TextInput
            value={values[field.key] ?? ''}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            autoFocus={autoFocus}
            className="w-full"
          />
        )
      case 'text':
        return (
          <Textarea
            value={values[field.key] ?? ''}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            autoFocus={autoFocus}
            rows={3}
            className="w-full resize-none"
          />
        )
      case 'enum':
      case 'parent':
        return (
          <Select
            value={valueOf(field)}
            onChange={(value) => set(field.key, value)}
            options={optionsFor(field)}
            placeholder={
              field.control === 'parent' ? `Choose a ${field.parentNoun ?? 'parent'}…` : 'Select…'
            }
            ariaLabel={field.label}
            className="w-full"
          />
        )
      case 'pubkey':
      case 'people':
        return (
          <PersonChipInput
            value={people[field.key] ?? []}
            // `pubkey` holds one person — a later pick replaces the current
            // one rather than growing a list the field cannot express.
            // `people` (invitees) keeps them all, as the app's dialog does.
            onChange={(next) =>
              setPeople((p) => ({
                ...p,
                [field.key]: field.control === 'pubkey' ? next.slice(-1) : next,
              }))
            }
            placeholder={field.placeholder}
          />
        )
    }
  }

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        // ⌘/Ctrl+Enter submits from any field; plain Enter keeps its meaning
        // inside a textarea and inside the pickers.
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          submit()
        }
      }}
    >
      <div className="flex flex-col gap-4 p-4 max-h-[400px] overflow-y-auto">
        {action.fields.map((field, i) => (
          <Field key={field.key} label={field.label} required={field.required}>
            {control(field, i === 0)}
          </Field>
        ))}
      </div>

      <div className="flex items-center justify-end px-4 pb-4 shrink-0">
        <Button variant="primary" onClick={submit} disabled={incomplete}>
          {action.submitLabel}
        </Button>
      </div>
    </div>
  )
}
