import { FieldLine } from '@estiva-app/ui'
import { Field } from '@/components/ui/Field'
import { Textarea } from '@/components/ui/Textarea'
import { SUMMARY_LIMIT, summaryLength } from '@/lib/summary'

/** The count a summary past about 240 characters shows under its field: a warning, never a refusal. */
export function SummaryCount({ text }: { text: string }) {
  const length = summaryLength(text)
  if (length <= SUMMARY_LIMIT) return null
  return (
    <FieldLine tone="warning">
      {length} characters. A summary reads best in one or two sentences, under {SUMMARY_LIMIT}.
    </FieldLine>
  )
}

/**
 * The optional Summary field of Start a topic, under the title: one or two
 * sentences, with a count past about 240 — Ship's New issue field, drawn as the
 * short-summary prototype's `PeekStartTopic` (Miky, 15 Oct). Empty is fine: the
 * topic is started without one.
 */
export function SummaryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const long = summaryLength(value) > SUMMARY_LIMIT
  return (
    // @estiva-escape(no-field-outside-a-form): one field of Start a topic's Form, drawn only inside it
    <Field label="Summary" helper={long ? undefined : 'One or two sentences. It shows under the title, in lists and on cards.'}>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="What is it for, in a sentence?"
        aria-label="Topic summary"
        className={long ? 'h-[80px]' : 'h-[60px]'}
      />
      <SummaryCount text={value} />
    </Field>
  )
}
