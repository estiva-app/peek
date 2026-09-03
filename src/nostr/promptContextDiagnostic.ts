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
import { getActiveConversation } from '@/lib/conversationRegistry'

export interface PromptContextDiagnostic {
  availability: ModelAvailability
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

/** Usage for one input: cheaply where the browser allows, else a real prompt. */
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
  await session.prompt(input)
  return { usage: session.inputUsage, how: 'prompt' }
}

async function snapshot(): Promise<PromptContextDiagnostic> {
  const notes: string[] = []
  const conversation = getActiveConversation()
  const messages = conversation?.messages ?? []
  const threadChars = messages.join('\n').length
  const bounded = threadContext(messages)

  const base: PromptContextDiagnostic = {
    availability: await prefillAvailability(),
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
  base.inputQuota = session.inputQuota
  base.baselineUsage = session.inputUsage

  /** A measurement that failed is no measurement, not a zero. */
  const measured = async (s: LanguageModelSession, input: string) => {
    try {
      return await usageOf(s, input)
    } catch (error) {
      notes.push(`Measuring ${input.length} characters failed: ${error instanceof Error ? error.message : String(error)}`)
      return { usage: undefined, how: 'prompt' as const }
    }
  }

  try {
    if (bounded) {
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
    const third = await createSession()
    if (third) {
      try {
        await third.session.prompt('Reply with an object.', {
          responseConstraint: { type: 'object', properties: { ok: { type: 'string' } } },
        })
        base.constrainedDecoding = 'works'
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
  return base
}

/**
 * Deliberately exceed the quota and report what the browser does about it.
 *
 * The measurement INT-1 calls the one that matters: silent truncation produces
 * a confident answer about half a conversation, and is indistinguishable from a
 * complete one unless somebody has looked.
 */
async function overflow(multiplier = 4): Promise<Record<string, unknown>> {
  const created = await createSession()
  if (!created) return { result: 'no session', createdWith: 'every entry refused' }
  const { session } = created
  const quota = session.inputQuota
  // Characters, not tokens — deliberately generous, since a token is several
  // characters and the point is to be far past the ceiling rather than near it.
  const size = (quota ?? 4096) * multiplier
  const filler = `${'The team discussed the deployment at length. '.repeat(Math.ceil(size / 44))}`.slice(0, size)
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
  const fn = () => snapshot()
  fn.overflow = overflow
  fn.options = () => SESSION_OPTIONS
  ;(window as unknown as Record<string, unknown>).__promptContext = fn
}
