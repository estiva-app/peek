/**
 * `window.__promptContext()` — INT-1's measurement, and what it says when it
 * cannot measure.
 *
 * The numbers themselves can only come from a browser holding a real model, so
 * what is testable here is the *reporting*: that a machine which cannot answer
 * says so plainly instead of returning zeros, that the whole-thread verdict is
 * computed against the real quota rather than guessed, and that overflow
 * distinguishes a refusal from silent acceptance.
 *
 * That last distinction is the one INT-1 calls the measurement that matters:
 * silent truncation produces a confident answer about half a conversation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPromptContextDiagnostic, type PromptContextDiagnostic } from './promptContextDiagnostic'
import { registerActiveConversation, unregisterActiveConversation } from '@/lib/conversationRegistry'
import { THREAD_CONTEXT_CHARS } from '@/lib/prefill'

type Diag = ((limitMs?: number) => Promise<PromptContextDiagnostic>) & {
  overflow: (multiplier?: number) => Promise<Record<string, unknown>>
  options: () => unknown[]
}
const diag = () => (window as unknown as { __promptContext: Diag }).__promptContext

/** A model whose session reports a quota and measures cheaply. */
function stubModel(opts: {
  quota?: number
  usageFor?: (input: string) => number
  refuseConstraint?: boolean
  refuseCreate?: boolean
}) {
  ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
    availability: async () => 'available',
    create: async () => {
      if (opts.refuseCreate) throw new Error('The feature flag gating model execution was disabled.')
      return {
        inputQuota: opts.quota,
        inputUsage: 0,
        measureInputUsage: async (input: string) => (opts.usageFor ?? ((i: string) => i.length / 4))(input),
        prompt: async (_input: string, options?: { responseConstraint?: object }) => {
          if (options?.responseConstraint && opts.refuseConstraint) {
            throw new Error('Constrained decoding (responseConstraint) cannot be used with speculative decoding (MTP).')
          }
          return '{"ok":"yes"}'
        },
        destroy: () => {},
      }
    },
  }
}

beforeEach(() => {
  installPromptContextDiagnostic()
})

afterEach(() => {
  delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel
  unregisterActiveConversation()
})

describe('installPromptContextDiagnostic', () => {
  it('installs on window, the way __readState does', () => {
    expect(typeof diag()).toBe('function')
    expect(typeof diag().overflow).toBe('function')
  })
})

describe('when no model can run', () => {
  it('says every session option was refused rather than reporting zeros', async () => {
    // Edge 154's actual behaviour: the interface exists, execution is gated.
    stubModel({ refuseCreate: true })
    const out = await diag()()
    expect(out.createdWith).toMatch(/refused/i)
    expect(out.inputQuota).toBeUndefined()
    expect(out.notes.join(' ')).toMatch(/Edge/)
  })

  it('reports the absent API without throwing', async () => {
    const out = await diag()()
    expect(out.availability).toBe('unavailable')
    expect(out.wholeThreadFits).toBeUndefined()
  })
})

describe('when no conversation is open', () => {
  it('says so, because that is the commonest reason a measurement is empty', async () => {
    stubModel({ quota: 4096 })
    const out = await diag()()
    expect(out.threadMessages).toBe(0)
    expect(out.notes.join(' ')).toMatch(/open a topic and click a message/i)
  })
})

describe('measuring a thread', () => {
  it('reports the bounded and whole-thread costs separately', async () => {
    /*
      They differ only when the thread exceeds the budget, and the difference is
      the whole point: what we send today versus what INT-3 was asked to send.
    */
    const long = 'The deployment broke again and we talked about it at length. '.repeat(200)
    registerActiveConversation({ references: [], messages: [long] })
    stubModel({ quota: 100_000, usageFor: (i) => i.length / 4 })

    const out = await diag()()
    expect(out.threadChars).toBeGreaterThan(THREAD_CONTEXT_CHARS)
    expect(out.boundedChars).toBeLessThanOrEqual(THREAD_CONTEXT_CHARS)
    expect(out.boundedUsage).toBeLessThan(out.wholeThreadUsage!)
    expect(out.measuredBy).toBe('measureInputUsage')
  })

  it('answers the question INT-1 exists for: does the whole thread fit', async () => {
    const long = 'x'.repeat(80_000)
    registerActiveConversation({ references: [], messages: [long] })
    // 80k chars ≈ 20k tokens against a 4096 quota — comfortably over.
    stubModel({ quota: 4096, usageFor: (i) => i.length / 4 })

    const out = await diag()()
    expect(out.wholeThreadFits).toBe(false)
    expect(out.notes.join(' ')).toMatch(/does NOT fit/)
    expect(out.notes.join(' ')).toMatch(/retrieval or map-reduce/)
  })

  it('says the thread was never truncated when it already fits the budget', async () => {
    registerActiveConversation({ references: [], messages: ['short enough'] })
    stubModel({ quota: 4096 })

    const out = await diag()()
    expect(out.wholeThreadFits).toBe(true)
    expect(out.notes.join(' ')).toMatch(/already fits/)
  })

  it('derives characters-per-token, so any budget can be converted', async () => {
    registerActiveConversation({ references: [], messages: ['a'.repeat(400)] })
    stubModel({ quota: 4096, usageFor: (i) => i.length / 4 })

    const out = await diag()()
    expect(out.charsPerToken).toBeCloseTo(4, 1)
  })
})

describe('constrained decoding', () => {
  it('records that a build honours a schema', async () => {
    stubModel({ quota: 4096 })
    expect((await diag()()).constrainedDecoding).toBe('works')
  })

  it('records the MTP refusal, which falsified PEE-5s premise', async () => {
    stubModel({ quota: 4096, refuseConstraint: true })
    expect((await diag()()).constrainedDecoding).toBe('refused')
  })
})

describe('overflow — the measurement that matters', () => {
  it('names silent acceptance as the dangerous outcome', async () => {
    /*
      A browser that takes 4x its quota without complaint has truncated
      something, and nothing said so. That is a confident answer about half a
      conversation, which is why the report warns rather than just recording.
    */
    stubModel({ quota: 4096, usageFor: (i) => i.length / 4 })
    const out = await diag().overflow(4)
    expect(out.result).toBe('accepted without complaint')
    expect(String(out.warning)).toMatch(/silent truncation/i)
    expect(out.charsSent).toBe(4096 * 4)
  })

  it('reports a refusal with the browser own words', async () => {
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        inputQuota: 4096,
        inputUsage: 0,
        prompt: async () => {
          throw new Error('input too large')
        },
        destroy: () => {},
      }),
    }
    const out = await diag().overflow(2)
    expect(out.result).toBe('refused')
    expect(String(out.error)).toContain('input too large')
  })

  it('says there was no session rather than pretending to measure', async () => {
    const out = await diag().overflow()
    expect(out.result).toBe('no session')
  })
})

/**
 * The first version returned nothing at all when run in Chrome — it was still
 * generating. Where `measureInputUsage` is absent every measurement is a real
 * prompt, and there are three, one over a deliberately oversized input.
 *
 * A diagnostic that can hang forever and says nothing is indistinguishable
 * from a broken one, which is the failure mode this whole subsystem keeps
 * producing. Partial numbers beat a promise that never settles.
 */
describe('a measurement that hangs is abandoned, not waited on', () => {
  it('returns a result with a note rather than never settling', async () => {
    registerActiveConversation({ references: [], messages: ['a'.repeat(500)] })
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        inputQuota: 4096,
        inputUsage: 0,
        // No measureInputUsage, and a prompt that never resolves.
        prompt: () => new Promise<string>(() => {}),
        destroy: () => {},
      }),
    }

    // A 2s budget rather than the 45s default: the behaviour under test is the
    // deadline, not its length, and the suite should not wait one out.
    const out = await Promise.race([
      diag()(2_000),
      new Promise<'never settled'>((r) => setTimeout(() => r('never settled'), 20_000)),
    ])

    expect(out).not.toBe('never settled')
    const report = out as PromptContextDiagnostic
    expect(report.boundedUsage).toBeUndefined()
    expect(report.notes.join(' ')).toMatch(/timed out|budget for the whole run/i)
  }, 30_000)

  it('reports whether the browser can price an input without generating one', async () => {
    // The field that explains why a run took seconds or minutes.
    stubModel({ quota: 4096 })
    expect((await diag()()).hasMeasureInputUsage).toBe(true)
  })

  it('warns when every measurement will cost a real generation', async () => {
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({ inputQuota: 4096, inputUsage: 7, prompt: async () => 'ok', destroy: () => {} }),
    }
    registerActiveConversation({ references: [], messages: ['short'] })

    const out = await diag()()
    expect(out.hasMeasureInputUsage).toBe(false)
    expect(out.notes.join(' ')).toMatch(/each measurement is a real prompt/i)
  })
})
