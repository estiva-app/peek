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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPromptContextDiagnostic, type PromptContextDiagnostic } from './promptContextDiagnostic'
import { registerActiveConversation, unregisterActiveConversation } from '@/lib/conversationRegistry'
import { THREAD_CONTEXT_CHARS } from '@/lib/prefill'

type Diag = ((limitMs?: number) => Promise<PromptContextDiagnostic>) & {
  overflow: (multiplier?: number) => Promise<Record<string, unknown>>
  sweep: (limitMs?: number) => Promise<Record<string, unknown>>
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

/**
 * What the first Chrome run taught, encoded so it cannot regress.
 *
 * Measured 2026-09-02 on the live app: `availability` said `available`,
 * `SESSION_OPTIONS[0]` was accepted, and then **every measurement timed out**
 * because the harness prompted with the raw thread and let the model generate
 * freely. It measured generation time, not the cost of the input.
 *
 * Chrome also reports neither `inputQuota` nor `inputUsage`, so token
 * accounting was never going to answer "does this fit". What it can answer is
 * whether an answer arrives and how long it takes.
 */
describe('measuring behaviour, since the token numbers are not on offer', () => {
  it('caps the generation instead of letting the model ramble', async () => {
    const prompt = vi.fn<(input: string) => Promise<string>>(async () => 'ok')
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({ inputQuota: undefined, inputUsage: undefined, prompt, destroy: () => {} }),
    }
    registerActiveConversation({ references: [], messages: ['the build broke'] })

    await diag()()
    // The thread is still sent; what is added is a bound on the answer.
    expect(prompt.mock.calls[0]?.[0]).toContain('the build broke')
    expect(prompt.mock.calls[0]?.[0]).toMatch(/single word: ok/i)
  })

  it('records how long each size took, and whether it answered', async () => {
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({ prompt: async () => 'ok', destroy: () => {} }),
    }
    registerActiveConversation({ references: [], messages: ['short thread'] })

    const out = await diag()()
    expect(out.timings.length).toBeGreaterThan(0)
    expect(out.timings[0].chars).toBeGreaterThan(0)
    expect(out.timings[0].answered).toBe(true)
    expect(out.notes.join(' ')).toMatch(/Slowest answer/)
  })

  it('says the latency is worse than the budget rather than unknown', async () => {
    // The honest reading of "nothing answered in 45s".
    registerActiveConversation({ references: [], messages: ['a'.repeat(300)] })
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({ prompt: () => new Promise<string>(() => {}), destroy: () => {} }),
    }

    const out = await diag()(1_500)
    expect(out.timings.every((t) => !t.answered)).toBe(true)
    expect(out.notes.join(' ')).toMatch(/worse than the budget/)
  }, 20_000)

  it('does not leak an uncaught rejection when a measurement is abandoned', async () => {
    /*
      Observed in Chrome: a constrained-decoding check timed out, the abandoned
      prompt rejected a moment later, and it surfaced as
      `Uncaught (in promise) NotSupportedError` in the console somebody was
      reading the report in.
    */
    const unhandled: unknown[] = []
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason)
    window.addEventListener('unhandledrejection', onUnhandled)

    registerActiveConversation({ references: [], messages: ['x'.repeat(200)] })
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: () => new Promise<string>((_r, reject) => setTimeout(() => reject(new Error('MTP')), 50)),
        destroy: () => {},
      }),
    }

    await diag()(10)
    await new Promise((r) => setTimeout(r, 200))
    window.removeEventListener('unhandledrejection', onUnhandled)
    expect(unhandled).toEqual([])
  })
})

/**
 * `sweep()` — the measurement the single-thread run could not make.
 *
 * Against a real 13-message conversation on 2026-09-02 it produced two timings
 * of 2327 and 2328 characters, because the thread fitted the budget whole: the
 * bounded and unbounded cases were the same measurement twice. It established
 * that 2.3k answers in 2.6s warm and said nothing whatever about scaling, and
 * scaling is what chooses between a bounded window and retrieval.
 */
describe('sweep — where latency stops being tolerable', () => {
  /** A model whose answer time grows with the input. */
  function scalingModel(msPerChar: number, failAbove = Infinity) {
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: (input: string) =>
          input.length > failAbove
            ? new Promise<string>(() => {})
            : new Promise<string>((r) => setTimeout(() => r('ok'), input.length * msPerChar)),
        destroy: () => {},
      }),
    }
  }

  it('sends prose, not repeated characters', async () => {
    /*
      `x`.repeat() compresses to almost nothing and would report a ceiling
      several times too generous. The filler has to tokenise like a
      conversation or the number is a fiction.
    */
    const seen: string[] = []
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (input: string) => {
          seen.push(input)
          return 'ok'
        },
        destroy: () => {},
      }),
    }
    await diag().sweep(5_000)
    expect(seen[0]).toMatch(/deployment failed again/i)
    expect(seen[0]).not.toMatch(/^x+/)
  })

  it('reports the largest size that answered', async () => {
    /*
      A 2s budget, not 20s: the sizes that answer do so instantly here, and the
      one that hangs then times out against whatever is left. A large budget
      makes the test wait out a hang it deliberately created.
    */
    scalingModel(0, 9_000)
    const out = await diag().sweep(2_000)
    expect(String(out.largestThatAnswered)).toMatch(/8000 chars/)
  }, 15_000)

  it('calls retrieval a requirement when latency degrades early', async () => {
    // The verdict INT-3 acts on, rather than a table somebody has to read.
    scalingModel(0, 5_000)
    const out = await diag().sweep(2_000)
    expect(String(out.verdict)).toMatch(/Retrieval is a requirement/)
  }, 15_000)

  it('calls a bounded window enough when it holds to 32k', async () => {
    scalingModel(0)
    const out = await diag().sweep(20_000)
    expect(String(out.verdict)).toMatch(/bounded window is enough/)
  })

  it('stops at the first size that does not answer', async () => {
    // Beyond a ceiling the numbers are all the same number.
    scalingModel(0, 5_000)
    const out = await diag().sweep(2_000)
    const rows = out.rows as { chars: number }[]
    expect(rows.map((r) => r.chars)).toEqual([2_000, 4_000, 8_000])
  }, 15_000)

  it('gives each size its own session', async () => {
    /*
      A reused session accumulates the previous answers, so a later measurement
      would be pricing the earlier ones too.
    */
    let creates = 0
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => {
        creates++
        return { prompt: async () => 'ok', destroy: () => {} }
      },
    }
    await diag().sweep(20_000)
    expect(creates).toBe(6)
  })

  it('says so when no session can be had', async () => {
    const out = await diag().sweep(1_000)
    expect(out.result).toBe('no session')
  })
})

/**
 * The sweep's own first run destroyed its results.
 *
 * Chrome, 2026-09-02: it answered at 2k, 4k, 8k, 16k and 32k, then 64k threw
 * `QuotaExceededError: The input is too large` — which propagated out and took
 * all five collected rows with it. **The refusal was the ceiling the function
 * exists to find**, and losing the run to it made the whole sweep pointless.
 */
describe('a refusal is a result, not the end of the run', () => {
  /** Answers below `refuseAbove`, throws above it — Chrome's actual behaviour. */
  function ceilingModel(refuseAbove: number) {
    ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      availability: async () => 'available',
      create: async () => ({
        prompt: async (input: string) => {
          if (input.length > refuseAbove) throw new Error('QuotaExceededError: The input is too large.')
          return 'ok'
        },
        destroy: () => {},
      }),
    }
  }

  it('keeps every row collected before the refusal', async () => {
    ceilingModel(40_000)
    const out = await diag().sweep(20_000)
    const rows = out.rows as { chars: number; answered: boolean }[]
    expect(rows.map((r) => r.chars)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 64_000])
    expect(rows.filter((r) => r.answered).map((r) => r.chars)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000])
  }, 20_000)

  it('reports the ceiling as a bracket, with the browser own words', async () => {
    ceilingModel(40_000)
    const out = await diag().sweep(20_000)
    expect(String(out.ceiling)).toMatch(/between 32000 and 64000/)
    expect(String(out.ceiling)).toMatch(/input is too large/i)
  }, 20_000)

  it('names the current budget when a bounded window turns out to be enough', async () => {
    // The verdict should say what to change, not only that something could.
    ceilingModel(40_000)
    const out = await diag().sweep(20_000)
    // Against the constant, not a literal: this asserts that the verdict names
    // the budget, which is the useful property. Pinning the number here made it
    // fail the moment INT-1's measurement changed it, which is the opposite of
    // what the test is for.
    expect(String(out.verdict)).toContain(`THREAD_CONTEXT_CHARS is currently ${THREAD_CONTEXT_CHARS}`)
    expect(String(out.verdict)).toMatch(/far below what answered/)
  }, 20_000)

  it('says the ceiling was not reached when everything answers', async () => {
    ceilingModel(Infinity)
    const out = await diag().sweep(20_000)
    expect(String(out.ceiling)).toMatch(/not reached/)
  }, 20_000)

  it('stops at the refusal rather than trying larger sizes', async () => {
    // Beyond a ceiling every larger size is refused for the same reason.
    ceilingModel(5_000)
    const out = await diag().sweep(20_000)
    const rows = out.rows as { chars: number }[]
    expect(rows.map((r) => r.chars)).toEqual([2_000, 4_000, 8_000])
  }, 20_000)
})
