import { useEffect, useMemo, useState } from 'react'
import type { Person } from '@/api'
import type { FormField, LauncherAction, LauncherApp, VocabOption } from '@/lib/launcherActions'
import { ScrollArea } from '@estiva-app/ui'
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
  /**
   * The scoped app, whose declared vocabularies feed `enum` fields.
   *
   * Optional since PEE-3: a field-setting action is reached from the global
   * level with an object as its target rather than an app as its scope, and
   * its vocabulary comes off the resolved action instead — see `vocabularies`.
   */
  app?: LauncherApp
  /** Live vocabularies, keyed by field key. Overrides the app's declared ones,
   *  the way `parentOptions` does for a `parent` control. */
  vocabularies?: Record<string, VocabOption[]>
  action: LauncherAction
  /** Live options for `parent` fields, keyed by field key. Overrides the
   *  registry's mock list — the launcher passes real topics for Peek. */
  parentOptions?: Record<string, VocabOption[]>
  /** Pre-filled values, keyed by field key (stories, and later: an agent
   *  filling the form from context instead of by hand — RFC 0.4 §13.4). */
  initialValues?: Record<string, string>
  /**
   * Values suggested from the conversation, arriving **after** the form opened
   * (PEE-5). Applied only to fields nobody has touched — see the effect below.
   */
  prefill?: Record<string, string>
  onSubmit: (values: Record<string, string>) => void
}

export function ActionFormPanel({
  app,
  vocabularies,
  action,
  parentOptions,
  initialValues,
  prefill,
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

  /**
   * Which fields the person has edited. The answer to PEE-6's typing race.
   *
   * > *"Prefill arriving after the person has started typing … Overwriting what
   * > somebody typed is unacceptable; discarding a useful suggestion silently
   * > is a waste. This needs a designed answer rather than whichever the
   * > implementation makes easy."*
   *
   * The designed answer is per **field**, not per form: a suggestion lands in
   * every box the person has not touched, and never in one they have. Typing a
   * title while the model is still thinking keeps the title and still gets the
   * description. Whole-form rules — first-write-wins, or last — each throw away
   * one half of that for no reason.
   */
  const [touched, setTouched] = useState<Set<string>>(() => new Set())

  const set = (key: string, value: string) => {
    setTouched((t) => (t.has(key) ? t : new Set(t).add(key)))
    setValues((v) => ({ ...v, [key]: value }))
  }

  /*
    A suggestion is not an edit: applying it must not mark the field touched,
    or a second suggestion could never correct the first — and the person
    overtyping it is what makes it theirs.
  */
  useEffect(() => {
    if (!prefill) return
    setValues((v) => {
      let changed = false
      const next = { ...v }
      for (const [key, value] of Object.entries(prefill)) {
        if (touched.has(key)) continue
        if (next[key] === value) continue
        next[key] = value
        changed = true
      }
      return changed ? next : v
    })
  }, [prefill, touched])

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
    if (field.control === 'enum')
      return vocabularies?.[field.key] ?? app?.vocabularies[field.vocabulary ?? ''] ?? []
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
      <ScrollArea viewportClassName="max-h-[400px]" contentClassName="flex flex-col gap-4 p-4 [&>*]:shrink-0">
        {action.fields.map((field, i) => (
          <Field key={field.key} label={field.label} required={field.required}>
            {control(field, i === 0)}
          </Field>
        ))}
      </ScrollArea>

      <div className="flex items-center justify-end px-4 pb-4 shrink-0">
        <Button variant="primary" onClick={submit} disabled={incomplete}>
          {action.submitLabel}
        </Button>
      </div>
    </div>
  )
}
