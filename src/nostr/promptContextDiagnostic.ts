/**
 * `window.__promptContext()` — what the on-device model will actually hold (INT-1).
 *
 * Same shape and the same reason as `window.__readState()` (CRO-14): the
 * question cannot be answered from a unit suite, because the answer lives in a
 * browser holding a real model and a real conversation. Every number below was
 * a guess until somebody ran this.
 *
 * **The guess it replaces.** `THREAD_CONTEXT_CHARS = 4000` was written for
 * PEE-5 with the reasoning beside it and never measured — its own comment says
 * so. Three architectures fit the feature INT-3 describes and this number
 * chooses between them: a bounded window, retrieval-then-generation, or
 * map-reduce. Filing against a guess is the backlog rule 2 forbids.
 *
 * ```
 * __promptContext()          measure this tab's open thread against the model
 * __promptContext.sweep()    the latency curve, which decides INT-3's architecture
 * __promptContext.overflow() deliberately exceed the quota and report what happens
 * ```
 *
 * **`wholeThreadFits` is the field that matters.** INT-1's parent asked to run
 * a prompt "against all the conversation and content", and that is implementable
 * or not depending on one boolean nobody had looked at.
 *
 * Read-only. It creates a session, measures, and destroys it — the same session
 * ladder prefill uses, so a build that refuses one refuses both and the report
 * says which options were accepted.
 */
import {
  SESSION_OPTIONS,
  createSession,
  prefillAvailability,
  type LanguageModelSession,
  type ModelAvailability,
  type SamplingOptions,
} from '@/lib/promptApi'
import { THREAD_CONTEXT_CHARS, threadContext } from '@/lib/prefill'
import { bodies, getActiveConversation } from '@/lib/conversationRegistry'

/**
 * How long any single measurement may take before it is abandoned.
 *
 * **Because the first version could hang forever and said nothing.** Where
 * `measureInputUsage` is absent every measurement is a real generation, and
 * this makes three — one of them over a deliberately oversized input. Run in
 * Chrome on 2026-09-02 it returned no result at all, which read exactly like a
 * broken diagnostic and was a slow one.
 *
 * A measurement that times out is reported as a timeout. Partial numbers are
 * worth more than a promise that never settles.
 */
const MEASUREMENT_LIMIT_MS = 30_000

/**
 * A budget for the whole run, not for each measurement.
 *
 * **A test caught this being the wrong shape.** Per-measurement timeouts are
 * sequential, so three hanging measurements meant ninety seconds — a
 * diagnostic that still looks broken, just less permanently. One deadline caps
 * the run however many measurements stall, and the ones that never started are
 * reported as skipped rather than as zero.
 */
const RUN_LIMIT_MS = 45_000

/** A run's clock. Measurements consult it rather than each starting their own. */
function budget(limit = RUN_LIMIT_MS) {
  const deadline = Date.now() + limit
  return {
    left: () => deadline - Date.now(),
    spent: () => Date.now() >= deadline,
  }
}

/** Bound one measurement by whatever the run has left, and say so. */
async function within<T>(promise: Promise<T>, msLeft: number): Promise<T | 'timeout'> {
  /*
    **The loser of a race still settles.** Observed in Chrome 2026-09-02: a
    constrained-decoding check timed out, the abandoned prompt rejected a moment
    later, and it surfaced as `Uncaught (in promise) NotSupportedError` in a
    console somebody was reading a report in. Swallowing it here is not hiding
    anything — the race already recorded the outcome as a timeout.
  */
  void promise.catch(() => {})
  if (msLeft <= 0) return 'timeout'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), Math.min(msLeft, MEASUREMENT_LIMIT_MS))
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Visible progress, because a silent minute is indistinguishable from a hang. */
function step(message: string): void {
  console.info(`[__promptContext] ${message}`)
}

export interface PromptContextDiagnostic {
  availability: ModelAvailability
  /** Present when the browser can price an input without generating one. */
  hasMeasureInputUsage: boolean
  /**
   * **The measurement INT-3 can actually use.** How long a thread of each size
   * took, and whether an answer arrived at all — because Chrome reports no
   * token numbers and a feature nobody waits for is not shipped.
   */
  timings: { chars: number; ms: number; answered: boolean }[]
  /** Which entry of `SESSION_OPTIONS` the browser accepted, or why none did. */
  createdWith: SamplingOptions | string
  /** How the usage numbers were obtained — the cheap way or a real prompt. */
  measuredBy: 'measureInputUsage' | 'prompt' | 'unavailable'

  /** Tokens the session may hold. The ceiling everything else is judged against. */
  inputQuota: number | undefined
  /** What an empty session already costs, before any thread. */
  baselineUsage: number | undefined

  /** The open thread, as `conversationRegistry` publishes it. */
  threadMessages: number
  threadChars: number
  /** What `threadContext` would actually send today, and its cap. */
  boundedChars: number
  budgetChars: number

  /** What the bounded thread costs, and what the WHOLE thread would cost. */
  boundedUsage: number | undefined
  wholeThreadUsage: number | undefined
  /** The answer to "can we ask against the whole conversation". */
  wholeThreadFits: boolean | undefined
  /** Derived, so any character count can be converted to tokens. */
  charsPerToken: number | undefined

  /** Whether this build honours a schema, which PEE-5's premise assumed. */
  constrainedDecoding: 'works' | 'refused' | 'untested'

  notes: string[]
}

/**
 * What INT-3 actually needs to know, since the token numbers are not on offer.
 *
 * **Chrome reports neither `inputQuota` nor `inputUsage`** (measured
 * 2026-09-02), so token accounting was never going to answer "does this fit".
 * What it will answer is the question underneath: **does a thread this size get
 * an answer, and how long does it take.** A feature nobody waits for is not
 * shipped whatever its token budget says.
 *
 * The generation is capped by asking for one word. The first version prompted
 * with the raw thread and let the model ramble, so it measured *generation*
 * time rather than the cost of the input — every measurement timed out and the
 * number that came back was about the wrong thing.
 */
const SHORT_ANSWER = '\n\nAnswer with the single word: ok'

async function usageOf(
  session: LanguageModelSession,
  input: string,
): Promise<{ usage: number | undefined; how: 'measureInputUsage' | 'prompt' }> {
  if (typeof session.measureInputUsage === 'function') {
    try {
      return { usage: await session.measureInputUsage(input), how: 'measureInputUsage' }
    } catch {
      // Fall through: present but refusing is the same as absent, for us.
    }
  }
  /*
    The expensive path. It generates, which costs a round trip and pollutes the
    session's own usage — so the caller reads `inputUsage` after and each
    measurement gets a fresh session rather than reusing one.

    **It throws rather than swallowing**, and that is load-bearing. `overflow()`
    exists to tell a browser that REFUSES an oversized input from one that takes
    it and quietly truncates; swallowing here reported the refusal as
    "accepted without complaint" and erased the distinction the function was
    written for. A test caught it. Callers that merely want a number catch it
    themselves — see `measured` in `snapshot`.
  */
  await session.prompt(`${input}${SHORT_ANSWER}`)
  return { usage: session.inputUsage, how: 'prompt' }
}

/** `limitMs` is the run's budget — overridable so a caller in a hurry, or a
 *  test exercising a hang, need not wait the default out. */
async function snapshot(limitMs = RUN_LIMIT_MS): Promise<PromptContextDiagnostic> {
  const notes: string[] = []
  const clock = budget(limitMs)
  const timings: PromptContextDiagnostic['timings'] = []
  const conversation = getActiveConversation()
  // Prose only: this measures what a context window costs, and the identity
  // INT-3 added to the snapshot never goes into one.
  const messages = bodies(conversation)
  const threadChars = messages.join('\n').length
  const bounded = threadContext(messages)

  step('asking availability')
  const base: PromptContextDiagnostic = {
    availability: await prefillAvailability(),
    hasMeasureInputUsage: false,
    timings,
    createdWith: 'not attempted',
    measuredBy: 'unavailable',
    inputQuota: undefined,
    baselineUsage: undefined,
    threadMessages: messages.length,
    threadChars,
    boundedChars: bounded.length,
    budgetChars: THREAD_CONTEXT_CHARS,
    boundedUsage: undefined,
    wholeThreadUsage: undefined,
    wholeThreadFits: undefined,
    charsPerToken: undefined,
    constrainedDecoding: 'untested',
    notes,
  }

  if (!conversation) {
    notes.push('No conversation is open — open a topic and click a message, then run this again.')
  }

  const created = await createSession()
  if (!created) {
    base.createdWith = 'every entry in SESSION_OPTIONS was refused'
    notes.push('No session. On Edge 154 this is expected: it gates generative model execution.')
    return base
  }
  const { session, options } = created
  base.createdWith = options
  base.hasMeasureInputUsage = typeof session.measureInputUsage === 'function'
  if (!base.hasMeasureInputUsage) {
    notes.push(
      `This build cannot price an input without generating one, so each measurement is a real prompt. The whole run is capped at ${limitMs / 1000}s.`,
    )
  }
  step(`session created${base.hasMeasureInputUsage ? ' (can measure cheaply)' : ' (must generate to measure)'}`)
  base.inputQuota = session.inputQuota
  base.baselineUsage = session.inputUsage

  /** A measurement that failed is no measurement, not a zero. */
  const measured = async (s: LanguageModelSession, input: string) => {
    const startedAt = Date.now()
    const elapsed = () => Date.now() - startedAt
    try {
      const result = await within(usageOf(s, input), clock.left())
      timings.push({ chars: input.length, ms: elapsed(), answered: result !== 'timeout' })
      if (result === 'timeout') {
        notes.push(
          clock.spent()
            ? `Measuring ${input.length} characters was skipped — the ${limitMs / 1000}s budget for the whole run was already spent.`
            : `Measuring ${input.length} characters timed out.`,
        )
        return { usage: undefined, how: 'prompt' as const }
      }
      return result
    } catch (error) {
      notes.push(`Measuring ${input.length} characters failed: ${error instanceof Error ? error.message : String(error)}`)
      return { usage: undefined, how: 'prompt' as const }
    }
  }

  try {
    if (bounded) {
      step(`measuring the bounded thread (${bounded.length} chars)`)
      const { usage, how } = await measured(session, bounded)
      base.boundedUsage = usage
      base.measuredBy = how
      if (usage !== undefined && usage > 0) base.charsPerToken = bounded.length / usage
    }

    /*
      The whole thread, on its own session. Reusing the one above would add its
      usage to the bounded measurement and report a number that is neither.
    */
    if (threadChars > bounded.length) {
      step(`measuring the whole thread (${threadChars} chars)`)
      const second = await createSession()
      if (second) {
        const { usage } = await measured(second.session, messages.join('\n'))
        base.wholeThreadUsage = usage
        if (usage !== undefined && session.inputQuota !== undefined) {
          base.wholeThreadFits = usage <= session.inputQuota
        }
        second.session.destroy()
      }
    } else if (threadChars > 0) {
      base.wholeThreadUsage = base.boundedUsage
      base.wholeThreadFits = true
      notes.push('The whole thread already fits inside the character budget, so it was not truncated.')
    }

    // Does this build honour a schema? PEE-5 assumed yes; Chrome with
    // speculative decoding refuses (measured 2026-09-02).
    step('testing constrained decoding')
    const third = await createSession()
    if (third) {
      try {
        const attempt = await within(
          third.session.prompt('Reply with an object.', {
            responseConstraint: { type: 'object', properties: { ok: { type: 'string' } } },
          }),
          clock.left(),
        )
        base.constrainedDecoding = attempt === 'timeout' ? 'untested' : 'works'
        if (attempt === 'timeout') notes.push('The constrained-decoding check timed out rather than answering.')
      } catch {
        base.constrainedDecoding = 'refused'
      }
      third.session.destroy()
    }
  } finally {
    session.destroy()
  }

  if (base.inputQuota === undefined) {
    notes.push('This build does not report inputQuota, so the ceiling can only be found by overflowing it.')
  }
  if (base.wholeThreadFits === false) {
    notes.push('The whole thread does NOT fit. INT-3 needs retrieval or map-reduce, not a bigger window.')
  }
  const answered = timings.filter((t) => t.answered)
  if (answered.length) {
    const slowest = Math.max(...answered.map((t) => t.ms))
    notes.push(`Slowest answer: ${(slowest / 1000).toFixed(1)}s. That is the latency INT-3 inherits.`)
  } else if (timings.length) {
    notes.push('Nothing answered inside the budget, so the latency is worse than the budget rather than unknown.')
  }
  step('done')
  return base
}

/**
 * Deliberately exceed the quota and report what the browser does about it.
 *
 * The measurement INT-1 calls the one that matters: silent truncation produces
 * a confident answer about half a conversation, and is indistinguishable from a
 * complete one unless somebody has looked.
 */
/**
 * Prose of a given length, because repeated characters do not tokenise like a
 * conversation.
 *
 * `'x'.repeat(n)` compresses to almost nothing and would report a ceiling
 * several times too generous. Sentences of the shape a work thread actually
 * contains are the only honest filler.
 */
function proseOf(chars: number): string {
  const sentence = 'The deployment failed again on main and Katerina asked whether the interop bump caused it. '
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars)
}

/**
 * `__promptContext.sweep()` — the curve that decides INT-3's architecture.
 *
 * **The single-thread measurement could not answer this.** Run against a real
 * 13-message conversation on 2026-09-02 it produced two timings of 2327 and
 * 2328 characters, because the thread fitted the budget whole and so the
 * bounded and unbounded cases were the same measurement twice. It established
 * that a 2.3k thread answers in 2.6s warm and said nothing about scaling.
 *
 * What INT-3 needs is where it stops: if latency stays tolerable to 32k then a
 * bounded window is enough and retrieval is only the accuracy mitigation; if it
 * degrades at 8k then retrieval is a latency requirement and the design is not
 * optional.
 *
 * Each size gets its own session, so a growing context is not measuring the
 * previous answers as well. Stops at the first size that does not answer —
 * beyond a ceiling the numbers are all the same number.
 */
async function sweep(limitMs = 120_000): Promise<Record<string, unknown>> {
  const clock = budget(limitMs)
  const sizes = [2_000, 4_000, 8_000, 16_000, 32_000, 64_000]
  const rows: { chars: number; ms: number; answered: boolean; refused?: string }[] = []

  for (const chars of sizes) {
    if (clock.spent()) {
      step(`stopping at ${chars} chars — the ${limitMs / 1000}s budget is spent`)
      break
    }
    const created = await createSession()
    if (!created) return { result: 'no session', rows }
    step(`sweeping ${chars} chars`)
    const startedAt = Date.now()
    /*
      **A refusal is a result, and the first version treated it as fatal.**
      Run in Chrome on 2026-09-02 the sweep answered at 2k, 4k, 8k, 16k and
      32k, then 64k threw `QuotaExceededError: The input is too large` — which
      propagated out and destroyed all five rows it had already collected. The
      refusal WAS the ceiling this function exists to find, and losing the run
      to it was the one outcome that made the whole sweep pointless.
    */
    let result: Awaited<ReturnType<typeof usageOf>> | 'timeout' | 'refused' = 'refused'
    let refusal: string | undefined
    try {
      result = await within(usageOf(created.session, proseOf(chars)), clock.left())
    } catch (error) {
      refusal = error instanceof Error ? error.message : String(error)
    }
    rows.push({
      chars,
      ms: Date.now() - startedAt,
      answered: result !== 'timeout' && refusal === undefined,
      ...(refusal ? { refused: refusal } : {}),
    })
    created.session.destroy()
    if (refusal !== undefined) {
      step(`${chars} chars was refused — ${refusal}`)
      break
    }
    if (result === 'timeout') {
      step(`${chars} chars did not answer — stopping`)
      break
    }
  }

  const answered = rows.filter((r) => r.answered)
  const largest = answered.length ? answered[answered.length - 1] : undefined
  const refused = rows.find((r) => r.refused)
  step('sweep done')
  return {
    rows,
    largestThatAnswered: largest ? `${largest.chars} chars in ${(largest.ms / 1000).toFixed(1)}s` : 'none',
    ceiling: refused
      ? `between ${largest?.chars ?? 0} and ${refused.chars} characters — ${refused.chars} was refused with "${refused.refused}"`
      : 'not reached; every size answered',
    verdict: !largest
      ? 'Nothing answered. Prefill and INT-3 are both out of reach on this machine.'
      : largest.chars >= 32_000
        ? `A bounded window is enough; retrieval is only the accuracy mitigation. THREAD_CONTEXT_CHARS is currently ${THREAD_CONTEXT_CHARS}, which is far below what answered.`
        : `Latency degrades before 32k. Retrieval is a requirement, not a mitigation — INT-3 should summarise selected messages rather than a window.`,
    note: 'Prose filler, not repeated characters: `x`.repeat() compresses and would report a ceiling several times too generous.',
  }
}

async function overflow(multiplier = 4): Promise<Record<string, unknown>> {
  const created = await createSession()
  if (!created) return { result: 'no session', createdWith: 'every entry refused' }
  const { session } = created
  const quota = session.inputQuota
  // Characters, not tokens — deliberately generous, since a token is several
  // characters and the point is to be far past the ceiling rather than near it.
  const size = (quota ?? 4096) * multiplier
  const filler = proseOf(size)
  try {
    const { usage, how } = await usageOf(session, filler)
    return {
      result: 'accepted without complaint',
      warning: 'Silent truncation is the dangerous case — nothing said the input was cut.',
      quota,
      charsSent: filler.length,
      usageReported: usage,
      measuredBy: how,
    }
  } catch (error) {
    return {
      result: 'refused',
      quota,
      charsSent: filler.length,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    session.destroy()
  }
}

/** Installed at module load from `@/api`, exactly as `__readState` is. */
export function installPromptContextDiagnostic(): void {
  if (typeof window === 'undefined') return
  const fn = (limitMs?: number) => snapshot(limitMs)
  fn.overflow = overflow
  fn.sweep = sweep
  fn.options = () => SESSION_OPTIONS
  ;(window as unknown as Record<string, unknown>).__promptContext = fn
}
