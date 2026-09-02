/**
 * Chrome's on-device Prompt API, wrapped (PEE-5, PEE-6).
 *
 * > **Miky, 2026-08-31** — *"Explore Prompt API as it could allow us cheaply
 * > prefill the form based on the context from the thread."*
 *
 * **On-device is the point, not a detail.** The model is Gemini Nano, running
 * locally — *"No data is sent to Google or any third party."* A work thread is
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

/** What `LanguageModel.availability()` answers. Chrome 138+. */
export type ModelAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available'

interface LanguageModelSession {
  prompt: (input: string, options?: { responseConstraint?: object }) => Promise<string>
  /** Tokens this session may hold. */
  readonly inputQuota?: number
  /** Tokens used so far. */
  readonly inputUsage?: number
  destroy: () => void
}

/** Sampling options, which Chrome requires rather than defaults. See `SAMPLING`. */
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
 * using a Chrome feature that offers it, not as a side effect of filing an
 * issue.
 *
 * Returns `'unavailable'` rather than throwing anywhere the API is absent,
 * which is every browser but recent desktop Chrome — and, importantly, jsdom,
 * so tests and Storybook take the no-model path without stubbing anything.
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

/** True only when a prompt would run against a model already on the machine. */
export async function canPrefill(): Promise<boolean> {
  return (await prefillAvailability()) === 'available'
}

/**
 * Ask the model for one object matching `schema`.
 *
 * The schema is the **constraint**, not a suggestion: Chrome takes a JSON
 * Schema as `responseConstraint` and holds the output to it. That is the whole
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
    const answer = await session.prompt(instruction, { responseConstraint: schema })
    const parsed: unknown = JSON.parse(answer)
    // Constrained decoding should make this impossible; a non-object here means
    // the constraint was not applied, and guessing at it would put invented
    // values in a form somebody is about to publish from.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
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
