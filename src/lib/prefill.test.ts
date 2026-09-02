/**
 * PEE-5 / PEE-6 — the schema is the constraint, and the bound is stated.
 *
 * The assertions worth reading are the two exclusions from the schema. A model
 * that fills in a **parent** picks where an object lands, which PEE-1 says is
 * never picked silently; a model that fills in a **pubkey** invents a plausible
 * 64-hex key belonging to nobody, and the relay would accept it. Both are
 * cheaper to forbid here than to detect afterwards.
 */
import { describe, expect, it } from 'vitest'
import type { FormField } from './launcherActions'
import {
  THREAD_CONTEXT_CHARS,
  formSchema,
  prefillInstruction,
  threadContext,
  usablePrefill,
} from './prefill'

const fields: FormField[] = [
  { key: 'title', label: 'Title', control: 'string', required: true },
  { key: 'description', label: 'Description', control: 'text' },
  { key: 'status', label: 'Status', control: 'enum', vocabulary: 'status' },
  { key: 'assignee', label: 'Assignee', control: 'pubkey' },
  { key: '__parent', label: 'Project', control: 'parent', required: true, parentNoun: 'project' },
]

const vocabularies = {
  status: [
    { value: 'todo', label: 'Todo' },
    { value: 'done', label: 'Done' },
  ],
}

describe('formSchema', () => {
  it('constrains an enum to the vocabulary the owning app declared', () => {
    const built = formSchema(fields, vocabularies)
    const properties = (built?.schema as { properties: Record<string, unknown> }).properties
    expect(properties.status).toEqual({ type: 'string', enum: ['todo', 'done'] })
  })

  it('never asks a model for the parent', () => {
    // Where a new object lands is a decision with consequences the model
    // cannot see, and PEE-1's rule is that the destination is shown before it
    // happens rather than guessed.
    const built = formSchema(fields, vocabularies)
    expect(built?.keys).not.toContain('__parent')
  })

  it('never asks a model for a pubkey', () => {
    // It would produce a well-formed key belonging to nobody, and the relay
    // takes whatever it is given.
    const built = formSchema(fields, vocabularies)
    expect(built?.keys).not.toContain('assignee')
  })

  it('asks for the text fields, which is the point', () => {
    expect(formSchema(fields, vocabularies)?.keys).toEqual(['title', 'description', 'status'])
  })

  it('marks every drawn field required, so the model answers about all of them', () => {
    const schema = formSchema(fields, vocabularies)?.schema as { required: string[]; additionalProperties: boolean }
    expect(schema.required).toEqual(['title', 'description', 'status'])
    // Constrained decoding with an open object would let it volunteer keys the
    // form has nowhere to put.
    expect(schema.additionalProperties).toBe(false)
  })

  it('drops an enum whose vocabulary did not resolve, rather than constraining to nothing', () => {
    const built = formSchema(fields, {})
    expect(built?.keys).toEqual(['title', 'description'])
  })

  it('returns null when there is nothing a model could write', () => {
    // An action that is only a parent and an assignee has no prose in it, and
    // running a model to fill in nothing is worse than not offering it.
    expect(formSchema([fields[3], fields[4]], vocabularies)).toBeNull()
  })
})

describe('threadContext', () => {
  it('keeps the newest messages and drops the oldest', () => {
    // The tail is where the thing being captured was decided.
    const messages = ['oldest', 'middle', 'newest']
    expect(threadContext(messages, 14)).toBe('middle\nnewest')
  })

  it('bounds by characters, because a message is not a unit of size', () => {
    const long = 'x'.repeat(THREAD_CONTEXT_CHARS + 100)
    expect(threadContext(['short', long])).toBe('short')
  })

  it('skips an oversized message rather than dropping the thread with it', () => {
    /*
      Found by the test above failing. Walking newest-first and STOPPING at the
      first message that would not fit meant one pasted stack trace as the
      latest message threw away the discussion around it — which is the part
      worth capturing.
    */
    const long = 'x'.repeat(THREAD_CONTEXT_CHARS + 100)
    expect(threadContext(['we should file this', long])).toBe('we should file this')
  })

  it('truncates rather than returning nothing when a single message is too big', () => {
    // Its opening is context. Its absence is none.
    const long = 'y'.repeat(THREAD_CONTEXT_CHARS + 100)
    expect(threadContext([long])).toBe('y'.repeat(THREAD_CONTEXT_CHARS))
  })

  it('collapses whitespace so a pasted block does not spend the budget on newlines', () => {
    expect(threadContext(['a\n\n\n   b'])).toBe('a b')
  })

  it('is empty for an empty thread, which is how the caller skips prefill', () => {
    expect(threadContext([])).toBe('')
    expect(threadContext(['', '   '])).toBe('')
  })
})

describe('prefillInstruction', () => {
  it('names the action the way the owning app named it', () => {
    // Inventing a better sentence here would be Peek deciding what another
    // app's action means.
    const instruction = prefillInstruction('Add issue', 'we should fix the build')
    expect(instruction).toContain('Add issue')
    expect(instruction).toContain('we should fix the build')
  })

  it('tells the model to leave a field empty rather than invent one', () => {
    expect(prefillInstruction('Add issue', 'x')).toMatch(/leave the field empty/i)
  })
})

describe('usablePrefill', () => {
  it('keeps the drawn fields', () => {
    expect(usablePrefill({ title: 'Build is broken' }, ['title'])).toEqual({ title: 'Build is broken' })
  })

  it('drops a blank answer rather than clearing a declared default', () => {
    // A key present with an empty string is the model saying it had nothing.
    expect(usablePrefill({ title: '   ' }, ['title'])).toEqual({})
  })

  it('drops a key the form never drew', () => {
    expect(usablePrefill({ title: 'a', invented: 'b' }, ['title'])).toEqual({ title: 'a' })
  })

  it('drops a non-string, whatever the constraint should have guaranteed', () => {
    expect(usablePrefill({ title: 42 } as unknown as Record<string, unknown>, ['title'])).toEqual({})
  })

  it('is empty for no answer at all', () => {
    expect(usablePrefill(null, ['title'])).toEqual({})
  })
})
