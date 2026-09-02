/**
 * The browser's on-device Prompt API, wrapped (PEE-5, PEE-6).
 *
 * **Named for the API, not a vendor.** Nothing here detects a browser: the only
 * gate is `typeof globalThis.LanguageModel`, so any engine exposing the
 * interface gets prefill.
 *
 * ## What the two browsers actually did, 2026-09-02
 *
 * | | `LanguageModel` | `availability()` | `create()` |
 * | --- | --- | --- | --- |
 * | Chrome | `function` | `unavailable` | **works** — prefill confirmed by a person |
 * | Edge | `function` | `unavailable` | throws *"The feature flag gating model execution was disabled"* |
 *
 * Both **expose** the interface; only Chrome would **run** it. Edge's refusal is
 * a browser policy gate rather than anything a consumer can influence, and it
 * arrives as a `create()` throw — which `createSession` already treats as "this
 * browser does not get prefill". So Edge degrading to a plain form is PEE-6
 * behaving correctly, not a defect to chase.
 *
 * Worth knowing when judging output quality: the model differs by browser, so a
 * verdict on a suggestion is a verdict on *whichever model answered*, and should
 * say which. Chrome's is Gemini Nano; Edge ships its own.
 *
 * > **Miky, 2026-08-31** — *"Explore Prompt API as it could allow us cheaply
 * > prefill the form based on the context from the thread."*
 *
 * **On-device is the point, not a detail.** The model runs locally, whichever
 * one the browser ships. A work thread is
 * confidential, and posting one to a cloud model to save somebody typing would
 * be a disclosure. This is the only shape of the feature consistent with how
 * the rest of the suite treats a Folder nobody outside it can read.
 *
 * Nothing here is in `lib.dom` yet, so the surface is declared below — narrowly,
 * covering only what is used. A wider guess at an API this new would be a
 * fiction that typechecks.
 *
 * ## What it deliberately does not do
 *
 * **It never blocks on the download** (PEE-6). First use per origin fetches a
 * multi-gigabyte model; a form that waits for that is broken for the person
 * who just wanted to type a title. `availability()` is consulted first and
 * `'downloadable'` is treated as *not available now* — true, and it keeps the
 * caller from starting a download nobody asked for.
 */

/** What `LanguageModel.availability()` answers. */
export type ModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface LanguageModelSession {
  prompt: (input: string, options?: { responseConstraint?: object }) => Promise<string>
  /** Tokens this session may hold. */
  readonly inputQuota?: number
  /** Tokens used so far. */
  readonly inputUsage?: number
  destroy: () => void
}

/** Sampling options, which some builds require rather than default. See `SAMPLING`. */
export interface SamplingOptions {
  samplingMode?: 'most-predictable'
  temperature?: number
  topK?: number
}

interface LanguageModelStatic {
  availability: (options?: SamplingOptions) => Promise<ModelAvailability>
  create: (options?: SamplingOptions & { initialPrompts?: { role: string; content: string }[] }) => Promise<LanguageModelSession>
}

declare global {
  var LanguageModel: LanguageModelStatic | undefined
}

/**
 * The sampling configurations to try, in order.
 *
 * **Chrome refuses a session with no sampling options at all**, measured in the
 * browser on 2026-09-02 — `create()` threw:
 *
 * > *The sampling options are incompatible with speculative decoding (MTP).
 * > Prompt API sessions must specify compatible sampling options, i.e.
 * > `samplingMode:'most-predictable'` or `topK:1` or `temperature:0`.*
 *
 * This code passed none, so every `create()` threw, `promptForObject` caught it
 * and returned null, and prefill silently never ran. Nothing failed visibly —
 * which is exactly what PEE-6 makes it look like on a machine with no model, so
 * the bug was indistinguishable from working correctly.
 *
 * `{temperature: 0, topK: 1}` was *also* refused in the same measurement, so
 * the list is ordered by what the browser itself named first and falls back
 * rather than guessing which build wants which. A browser that accepts none of
 * them gets no prefill, which is the honest outcome.
 *
 * **Determinism is right here regardless of the error.** The output is
 * constrained to a schema and drops straight into a form somebody is about to
 * publish from; sampling creatively over a colleague's conversation is not a
 * feature. `most-predictable` is what this would have asked for had the API
 * made it a choice from the start.
 */
export const SAMPLING: SamplingOptions[] = [
  { samplingMode: 'most-predictable' },
  { temperature: 0, topK: 1 },
  { topK: 1 },
]

/**
 * Whether prefill can run **right now**, without downloading anything.
 *
 * `'downloadable'` is reported as unavailable on purpose. It is honest — the
 * model is not there — and it is what stops Peek starting a 22 GB fetch
 * because somebody opened a form. A person who wants the model gets it by
 * using a browser feature that offers it, not as a side effect of filing an
 * issue.
 *
 * Returns `'unavailable'` rather than throwing anywhere the API is absent —
 * most browsers, every phone, and importantly jsdom, so tests and Storybook
 * take the no-model path without stubbing anything.
 *
 * Note this answer is a hint rather than a verdict: see `canPrefill`, where
 * a browser reporting `'unavailable'` was measured creating working sessions.
 */
export async function prefillAvailability(): Promise<ModelAvailability> {
  if (typeof globalThis.LanguageModel === 'undefined') return 'unavailable'
  try {
    return await globalThis.LanguageModel.availability()
  } catch {
    // A throw here is the API refusing to answer — indistinguishable, for our
    // purposes, from not having it.
    return 'unavailable'
  }
}

/**
 * Whether to attempt a session at all.
 *
 * **Not `availability() === 'available'`, which was too strict.** Measured in
 * Chrome on 2026-09-02: `availability()` answered `'unavailable'` while
 * `create()` on the same page succeeded and produced a working session. Gating
 * on `'available'` meant prefill never even tried on a machine that could run
 * it — the exact machine this feature was written for.
 *
 * So the gate is inverted: it refuses only the two answers that mean *touching
 * this starts a download* — the 22 GB fetch nobody asked for, which is the one
 * thing PEE-6 forbids. `'unavailable'` is attempted, because this browser
 * demonstrated that answer is not the last word, and a refusal costs one fast
 * throw that `promptForObject` already swallows.
 */
export async function canPrefill(): Promise<boolean> {
  const availability = await prefillAvailability()
  return availability !== 'downloadable' && availability !== 'downloading'
}

/**
 * Ask the model for one object matching `schema`.
 *
 * The schema is the **constraint** where the browser allows it: the API takes a
 * JSON Schema as `responseConstraint` and holds the output to it. Where it does
 * not — see the MTP refusal below — the same schema becomes an instruction. That is the whole
 * reason this feature is cheap — see `formSchema`, which builds the schema from
 * the same declaration that drew the form, so an app nobody here wrote gets
 * prefill on the day it publishes a manifest.
 *
 * Returns null rather than throwing on anything at all. Prefill is an
 * enhancement; a person is looking at a working form either way, and a
 * rejected promise here would turn a nicety into an error they have to read.
 */
export async function promptForObject(
  instruction: string,
  schema: object,
): Promise<Record<string, unknown> | null> {
  if (typeof globalThis.LanguageModel === 'undefined') return null
  let session: LanguageModelSession | null = null
  try {
    session = await createSession(globalThis.LanguageModel)
    if (!session) return null
    /*
      The constrained path first, because where it works the schema does the
      work and nothing can come back malformed.

      **It is refused outright on some builds.** Measured in Chrome on
      2026-09-02: `prompt(…, {responseConstraint})` threw *"Constrained
      decoding (responseConstraint) cannot be used with speculative decoding
      (MTP)"* — while the very same build REQUIRES sampling options because MTP
      is on. The two demands are mutually exclusive there, so PEE-5's premise
      that the declaration can always be the constraint does not hold, and a
      consumer that only knows the constrained path gets nothing at all.
    */
    try {
      /*
        Strict here on purpose. Constrained decoding should make a non-object
        impossible, so one means the constraint was NOT applied — and being
        lenient about that would hide a real problem behind values invented for
        a form somebody is about to publish from.
      */
      return strictParse(await session.prompt(instruction, { responseConstraint: schema }))
    } catch {
      /*
        Ask in words instead, and parse leniently. Strictly worse — the model
        may return prose, fences or an extra sentence — which is why it is the
        fallback and not the path. `looseParse` treats anything unusable as no
        answer, so the failure mode stays "no prefill" rather than junk in a
        form somebody is about to publish from.
      */
      return looseParse(await session.prompt(`${instruction}\n\n${jsonHint(schema)}`))
    }
  } catch {
    return null
  } finally {
    // Sessions hold the model's context. Not destroying one leaks it for the
    // life of the page, and the launcher opens a form per capture.
    session?.destroy()
  }
}

/**
 * A session, trying each sampling configuration until one is accepted.
 *
 * Returns null rather than throwing when every one is refused — the caller
 * treats that as "no prefill", which is the same outcome as no model at all.
 */
async function createSession(model: LanguageModelStatic): Promise<LanguageModelSession | null> {
  for (const options of SAMPLING) {
    try {
      return await model.create(options)
    } catch {
      // Refused for these options. Try the next spelling; a browser that
      // refuses all of them simply does not get prefill.
    }
  }
  return null
}

/**
 * The instruction that replaces a schema the browser will not honour.
 *
 * Built from the same schema, so the fields asked for cannot drift from the
 * fields drawn — which is the property that made the constrained path worth
 * having, kept as far as words can keep it.
 */
export function jsonHint(schema: object): string {
  const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {}
  const keys = Object.keys(properties)
  return [
    `Reply with only a JSON object, no prose and no code fence.`,
    `It must have exactly these keys, each a string: ${keys.join(', ')}.`,
    `Use "" for a field the conversation does not answer.`,
  ].join(' ')
}

/**
 * The constrained answer, taken at face value or not at all.
 *
 * Catches its own parse error rather than throwing, so a mangled *constrained*
 * reply does not fall through to the unconstrained retry: the constraint was
 * honoured and produced junk, which is a different problem from the browser
 * refusing constraints, and retrying would paper over it.
 */
export function strictParse(answer: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(answer)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * A JSON object out of whatever came back.
 *
 * Only for the unconstrained fallback, where the reply may carry a fence, a
 * leading sentence, or both. It takes the text between the first `{` and the
 * last `}`, which means a lone object wrapped in an array is unwrapped — a
 * model doing that has still answered, and `usablePrefill` filters the keys
 * either way. Several objects in an array do not survive it, which is correct:
 * that is a different answer, not a wrapped one.
 *
 * Returns null rather than throwing, so a mangled answer is indistinguishable
 * from no model: no prefill, no error to read.
 */
export function looseParse(answer: string | null): Record<string, unknown> | null {
  if (!answer) return null
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(answer.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
