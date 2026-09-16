import type { FormField, LauncherAction, LauncherApp, VocabOption } from '@/lib/launcherActions'
import { article, valueOf, type FormDraft } from '@/lib/formDraft'
import { Field } from './ui/Field'
import { PersonChipInput } from './ui/PersonChipInput'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { TextInput } from './ui/TextInput'

/**
 * The fields of a form drawn from an action declaration — the launcher's form
 * level, inside the package's `CommandPaletteForm`.
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
 * **Fields only, since UIG-29.** The frame — the button, Ctrl+Enter, the lock
 * while creating, where focus goes — is the palette's (Katerina, 16 September,
 * P2). And **what was typed is the launcher's**, not this component's, so it
 * survives going back and coming in again (R1 A): the draft is passed in and
 * every edit is handed back.
 *
 * **A missing field says what it needs** (the key list: "Ctrl+Enter creates; if
 * something is missing, each field says what it needs and focus goes to the
 * first"). It replaces the 31 August rule that kept the button disabled until
 * every required field was filled, which gave no reason (R14).
 */

export interface ActionFormFieldsProps {
  /**
   * The scoped app, whose declared vocabularies feed `enum` fields.
   *
   * Optional since PEE-3: a field-setting action is reached from the first
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
  draft: FormDraft
  onDraft: (next: FormDraft) => void
  /** What each missing field needs, once a submission has been tried. */
  missing?: Record<string, string>
}

export function ActionFormFields({ app, vocabularies, action, parentOptions, draft, onDraft, missing = {} }: ActionFormFieldsProps) {
  const set = (key: string, value: string) =>
    onDraft({
      ...draft,
      values: { ...draft.values, [key]: value },
      touched: draft.touched.includes(key) ? draft.touched : [...draft.touched, key],
    })

  const optionsFor = (field: FormField): VocabOption[] => {
    if (field.control === 'enum') return vocabularies?.[field.key] ?? app?.vocabularies[field.vocabulary ?? ''] ?? []
    if (field.control === 'parent') {
      const live = parentOptions?.[field.key]
      return live && live.length > 0 ? live : (field.parentOptions ?? [])
    }
    return []
  }

  const control = (field: FormField) => {
    switch (field.control) {
      case 'string':
        return (
          <TextInput
            value={draft.values[field.key] ?? ''}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full"
          />
        )
      case 'text':
        return (
          <Textarea
            value={draft.values[field.key] ?? ''}
            onChange={(e) => set(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            className="w-full resize-none"
          />
        )
      case 'enum':
      case 'parent':
        return (
          <Select
            value={valueOf(field, draft)}
            onChange={(value) => set(field.key, value)}
            options={optionsFor(field)}
            placeholder={field.control === 'parent' ? `Choose ${article(field.parentNoun ?? 'parent')}…` : 'Select…'}
            ariaLabel={field.label}
            className="w-full"
          />
        )
      case 'pubkey':
      case 'people':
        return (
          <PersonChipInput
            value={draft.people[field.key] ?? []}
            // `pubkey` holds one person — a later pick replaces the current
            // one rather than growing a list the field cannot express.
            // `people` (invitees) keeps them all, as the app's dialog does.
            onChange={(next) =>
              onDraft({
                ...draft,
                people: { ...draft.people, [field.key]: field.control === 'pubkey' ? next.slice(-1) : next },
                touched: draft.touched.includes(field.key) ? draft.touched : [...draft.touched, field.key],
              })
            }
            placeholder={field.placeholder}
          />
        )
    }
  }

  return (
    <>
      {action.fields.map((field) => (
        <Field key={field.key} label={field.label} required={field.required} error={missing[field.key]}>
          {control(field)}
        </Field>
      ))}
    </>
  )
}
