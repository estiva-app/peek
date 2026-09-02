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

interface LanguageModelStatic {
  availability: () => Promise<ModelAvailability>
  create: (options?: { initialPrompts?: { role: string; content: string }[] }) => Promise<LanguageModelSession>
}

declare global {
  var LanguageModel: LanguageModelStatic | undefined
}

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
  let session: LanguageModelSession | undefined
  try {
    session = await globalThis.LanguageModel.create()
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
