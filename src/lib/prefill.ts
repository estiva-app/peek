/**
 * Prefilling a launcher form from the conversation (PEE-5).
 *
 * **The insight the whole feature rests on:** a manifest action's `input` is
 * already a JSON Schema, and Chrome's Prompt API takes a JSON Schema as
 * `responseConstraint`. So the same declaration that draws the form constrains
 * the model — no mapping layer, no per-app prompt engineering, and an HR tool
 * declaring `add-candidate` gets prefill on the day it publishes its manifest.
 *
 * The schema here is rebuilt from the **fields the form actually drew**
 * (`FormField[]`) rather than from the manifest's raw `input`. The runtime does
 * not carry the raw schema through, and rebuilding turns out to be the better
 * end anyway: it guarantees the model is constrained to exactly what the person
 * can see and edit. A constraint listing a property the consumer chose not to
 * draw would put a value in a form with nowhere to show it.
 */
import type { FormField, VocabOption } from './launcherActions'

/** The synthetic parent field is Peek's, not the app's — never a model's to fill. */
const SYNTHETIC = new Set(['__parent'])

/**
 * A JSON Schema for one action's form.
 *
 * Only the fields a model could sensibly write: an `enum` is constrained to its
 * declared vocabulary, a free-text field to a string. Two are excluded on
 * purpose:
 *
 * - **The parent.** Where a new object hangs is a decision with consequences a
 *   model cannot see, and PEE-1's rule is that the destination is never picked
 *   silently. Guessing it would be exactly that, one layer further from the
 *   person.
 * - **A person picker.** A pubkey is an identifier, not prose. A model asked
 *   for one produces a plausible 64-hex string that belongs to nobody, and the
 *   relay would take it.
 */
export function formSchema(
  fields: readonly FormField[],
  /** The vocabularies the form itself draws from, keyed as `ActionFormPanel`
   *  looks them up. An `enum` has no values without them. */
  vocabularies: Record<string, VocabOption[]> = {},
): { schema: object; keys: string[] } | null {
  const properties: Record<string, object> = {}

  for (const field of fields) {
    if (SYNTHETIC.has(field.key) || field.control === 'parent') continue
    if (field.control === 'pubkey' || field.control === 'people') continue
    if (field.control === 'enum') {
      const values = (vocabularies[field.key] ?? vocabularies[field.vocabulary ?? ''] ?? []).map((o) => o.value)
      // A vocabulary the consumer could not resolve is not a constraint.
      if (!values.length) continue
      properties[field.key] = { type: 'string', enum: values }
    } else {
      properties[field.key] = { type: 'string' }
    }
  }

  const keys = Object.keys(properties)
  if (!keys.length) return null
  return {
    schema: {
      type: 'object',
      properties,
      // Every drawn field, so the model answers about all of them rather than
      // picking the one it finds easiest.
      required: keys,
      additionalProperties: false,
    },
    keys,
  }
}

/**
 * How much of the thread to send.
 *
 * PEE-5 leaves this open — *"a long topic will not fit the context window …
 * the choice is worth testing rather than deciding on paper"* — so this is a
 * **stated default, not a settled answer**: the most recent messages, newest
 * last, bounded by characters rather than by count.
 *
 * Bounded by characters because a message is not a unit of size: ten one-word
 * replies and one pasted stack trace are both "ten messages". The bound is
 * deliberately well under any plausible context window, since overflowing it
 * costs a silent truncation somewhere we cannot see, and the tail of a
 * conversation is where the thing being captured was decided anyway.
 *
 * Whoever tests this against a real topic should change the number and say what
 * they measured. `inputUsage` against `inputQuota` is how to find the real
 * ceiling honestly.
 */
export const THREAD_CONTEXT_CHARS = 4000

/**
 * The thread, trimmed from the *oldest* end so the newest survives.
 *
 * A message that will not fit is **skipped rather than ending the walk**, and
 * the reason is a case a test caught: the newest message being one pasted
 * stack trace dropped the entire thread and prefill got nothing. The useful
 * context in that thread is the discussion around the paste, which is older
 * than it. Skipping keeps that; stopping threw it away.
 *
 * If nothing fits at all — a single message longer than the whole budget — the
 * newest is truncated instead of returning empty. Its opening is context; its
 * absence is none.
 */
export function threadContext(messages: readonly string[], limit = THREAD_CONTEXT_CHARS): string {
  const flat = messages.map((m) => m.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const kept: string[] = []
  let total = 0
  for (let i = flat.length - 1; i >= 0; i--) {
    const message = flat[i]
    if (total + message.length > limit) continue
    kept.unshift(message)
    total += message.length
  }
  if (!kept.length && flat.length) return flat[flat.length - 1].slice(0, limit)
  return kept.join('\n')
}

/**
 * The instruction, with the conversation as its material.
 *
 * The action's own label is the task description — "Add issue" — because it is
 * what the owning app calls the thing, and inventing a better sentence here
 * would be Peek deciding what another app's action means.
 */
export function prefillInstruction(actionLabel: string, conversation: string): string {
  return [
    `A team is having this conversation:`,
    '',
    conversation,
    '',
    `Fill in the fields for "${actionLabel}" from that conversation.`,
    `Use only what the conversation says. Where it does not say, leave the field empty.`,
  ].join('\n')
}

/**
 * The values worth putting in the form.
 *
 * Anything the model returned that is not a drawn field is dropped, and so is
 * anything blank — a key present with an empty string is the model saying it
 * had nothing, and writing that into the field would clear a default the
 * action declared.
 */
export function usablePrefill(
  answer: Record<string, unknown> | null,
  keys: readonly string[],
): Record<string, string> {
  if (!answer) return {}
  const out: Record<string, string> = {}
  for (const key of keys) {
    const value = answer[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) out[key] = trimmed
  }
  return out
}
