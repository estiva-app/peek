/**
 * PEE-6 — the gate, and the download that must never start by accident.
 *
 * The population that gets prefill is: recent desktop Chrome, with 22 GB free
 * and either >4 GB VRAM or 16 GB RAM, **after a download has completed**.
 * Everyone else gets the form. So the interesting assertions here are the
 * negative ones — what this does *not* do on the machines that cannot run it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUTPUT_LANGUAGE, SESSION_OPTIONS, canPrefill, jsonHint, looseParse, prefillAvailability, promptForObject } from './promptApi'

type Stub = {
  availability: () => Promise<string>
  create: () => Promise<{ prompt: () => Promise<string>; destroy: () => void }>
}

function stubModel(stub: Partial<Stub>) {
  ;(globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = stub
}

afterEach(() => {
  delete (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel
})

describe('prefillAvailability', () => {
  it('is unavailable where the API does not exist', async () => {
    /*
      Every browser but recent desktop Chrome — and jsdom, which is why the
      whole suite and Storybook take the no-model path without stubbing
      anything. That is the default this feature is built around, not an edge.
    */
    expect(await prefillAvailability()).toBe('unavailable')
  })

  it('reports what the API says when it exists', async () => {
    stubModel({ availability: async () => 'available' })
    expect(await prefillAvailability()).toBe('available')
  })

  it('does not throw when the API refuses to answer', async () => {
    stubModel({
      availability: () => {
        throw new Error('nope')
      },
    })
    expect(await prefillAvailability()).toBe('unavailable')
  })
})

describe('canPrefill — the gate, loosened on measurement', () => {
  it('is true for a model already on the machine', async () => {
    stubModel({ availability: async () => 'available' })
    expect(await canPrefill()).toBe(true)
  })

  it('is FALSE for "downloadable", so opening a form never starts a 22 GB fetch', async () => {
    /*
      The one thing PEE-6 forbids. A person who wants the model gets it from a
      browser affordance that says so, not as a side effect of filing an issue.
    */
    stubModel({ availability: async () => 'downloadable' })
    expect(await canPrefill()).toBe(false)
  })

  it('is false while a download is already in flight', async () => {
    stubModel({ availability: async () => 'downloading' })
    expect(await canPrefill()).toBe(false)
  })

  it('ATTEMPTS anyway on "unavailable", because that answer proved not to be final', async () => {
    /*
      Measured in Chrome on 2026-09-02: `availability()` answered
      'unavailable' while `create()` on the same page succeeded and produced a
      working session. Gating on === 'available' meant prefill never tried on
      exactly the machine it was written for. A refusal costs one fast throw
      that `promptForObject` already swallows; a wrong refusal costs the
      feature.
    */
    stubModel({ availability: async () => 'unavailable' })
    expect(await canPrefill()).toBe(true)
  })

  it('attempts where the API is absent too, and the prompt path returns null', async () => {
    // No stub at all. Cheap, and it keeps the decision in one place.
    expect(await canPrefill()).toBe(true)
    expect(await promptForObject('go', { type: 'object', properties: {} })).toBeNull()
  })
})

describe('promptForObject', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } } }

  it('returns the parsed object and passes the schema as the constraint', async () => {
    const prompt = vi.fn(async () => JSON.stringify({ title: 'Build is broken' }))
    const destroy = vi.fn()
    stubModel({ availability: async () => 'available', create: async () => ({ prompt, destroy }) })

    expect(await promptForObject('go', schema)).toEqual({ title: 'Build is broken' })
    expect(prompt).toHaveBeenCalledWith('go', { responseConstraint: schema })
  })

  it('destroys the session, which holds the model context', async () => {
    // The launcher opens a form per capture; a leaked session per form holds
    // context for the life of the page.
    const destroy = vi.fn()
    stubModel({
      availability: async () => 'available',
      create: async () => ({ prompt: async () => '{"title":"x"}', destroy }),
    })
    await promptForObject('go', schema)
    expect(destroy).toHaveBeenCalled()
  })

  it('destroys the session even when the prompt throws', async () => {
    const destroy = vi.fn()
    stubModel({
      availability: async () => 'available',
      create: async () => ({
        prompt: async () => {
          throw new Error('context overflow')
        },
        destroy,
      }),
    })
    expect(await promptForObject('go', schema)).toBeNull()
    expect(destroy).toHaveBeenCalled()
  })

  it('returns null rather than throwing where there is no API', async () => {
    // Prefill is an enhancement. A rejected promise here would turn a nicety
    // into an error somebody has to read.
    expect(await promptForObject('go', schema)).toBeNull()
  })

  it('returns null for unparseable output', async () => {
    stubModel({
      availability: async () => 'available',
      create: async () => ({ prompt: async () => 'not json at all', destroy: () => {} }),
    })
    expect(await promptForObject('go', schema)).toBeNull()
  })

  it('returns null for an array on the CONSTRAINED path, which means the constraint was not applied', async () => {
    /*
      Strict here, deliberately: the constraint was honoured and produced the
      wrong shape, which is a different problem from a browser that refuses
      constraints, and guessing would put invented values in a form somebody is
      about to publish from. The unconstrained fallback is the lenient one.
    */
    stubModel({
      availability: async () => 'available',
      create: async () => ({ prompt: async () => '[{"title":"x"}]', destroy: () => {} }),
    })
    expect(await promptForObject('go', schema)).toBeNull()
  })
})

/**
 * The bug these guard, measured in Chrome on 2026-09-02.
 *
 * `create()` was called with **no options at all** and the browser threw:
 *
 * > *The sampling options are incompatible with speculative decoding (MTP).
 * > Prompt API sessions must specify compatible sampling options, i.e.
 * > `samplingMode:'most-predictable'` or `topK:1` or `temperature:0`.*
 *
 * `promptForObject` caught it and returned null, so prefill silently never ran
 * — indistinguishable from the no-model case PEE-6 deliberately makes silent.
 * The old tests passed throughout, because their stub accepted any `create()`.
 * These assert the argument, which is the thing that was wrong.
 */
describe('sampling options are required, not optional (measured in Chrome)', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' } } }
  const CHROME_REFUSAL =
    'The sampling options are incompatible with speculative decoding (MTP). ' +
    "Prompt API sessions must specify compatible sampling options, i.e. `samplingMode:'most-predictable'`" +
    ' or `topK:1` or `temperature:0`.'

  it('never asks for a session without them', async () => {
    /*
      Typed with `vi.fn<T>`, not `async () => …`: a zero-parameter mock gives
      `mock.calls` the tuple type `[]`, so reading `calls[0][0]` is a type
      error vitest never sees — it strips types. `npm run build` catches it,
      which is exactly what happened here. `CommandLauncher.live.test.tsx`
      documents the same trap.
    */
    const create = vi.fn<(options?: unknown) => Promise<{ prompt: () => Promise<string>; destroy: () => void }>>(
      async () => ({ prompt: async () => '{"title":"x"}', destroy: () => {} }),
    )
    stubModel({ availability: async () => 'available', create: create as unknown as Stub['create'] })

    await promptForObject('go', schema)
    expect(create).toHaveBeenCalled()
    const passed = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(passed).toBeDefined()
    // Whichever spelling is first, it must be one the browser named.
    expect(Object.keys(passed ?? {}).length).toBeGreaterThan(0)
    expect(passed).toEqual(SESSION_OPTIONS[0])
  })

  it('asks for the most predictable output, because it fills a form to be published', async () => {
    // Sampling creatively over a colleague's conversation is not a feature.
    expect(SESSION_OPTIONS[0].samplingMode).toBe('most-predictable')
    // Every fallback keeps determinism one way or another; none samples freely.
    for (const options of SESSION_OPTIONS) {
      const deterministic =
        options.samplingMode === 'most-predictable' || options.topK === 1 || options.temperature === 0
      expect(deterministic).toBe(true)
    }
  })

  it('names an output language, which both browsers asked for', async () => {
    /*
      Measured 2026-09-02. Edge 154 named the set it accepts —
      `[de, en, es, fr, ja]` — where Chrome said `[*]`. Asked for "to ensure
      optimal output quality and properly attest to output safety", so it is
      not decoration.
    */
    expect(SESSION_OPTIONS[0].outputLanguage).toBe(OUTPUT_LANGUAGE)
    expect(['de', 'en', 'es', 'fr', 'ja']).toContain(OUTPUT_LANGUAGE)
  })

  it('falls back to a session with no language rather than none at all', async () => {
    // A build that rejects the option is still better served by a suggestion
    // than by silence, so the language is dropped before the feature is.
    expect(SESSION_OPTIONS.some((o) => !o.outputLanguage && !o.expectedOutputs)).toBe(true)
  })

  it('falls back when a build refuses the first spelling', async () => {
    /*
      `{temperature: 0, topK: 1}` was refused in the same measurement that
      refused no-options, so the list is tried in order rather than assumed.
    */
    const create = vi.fn(async (options: unknown) => {
      if (JSON.stringify(options) === JSON.stringify(SESSION_OPTIONS[0])) throw new Error(CHROME_REFUSAL)
      return { prompt: async () => '{"title":"x"}', destroy: () => {} }
    })
    stubModel({ availability: async () => 'available', create: create as unknown as Stub['create'] })

    expect(await promptForObject('go', schema)).toEqual({ title: 'x' })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]?.[0]).toEqual(SESSION_OPTIONS[1])
  })

  it('gives up quietly when every spelling is refused', async () => {
    // A browser that accepts none simply gets no prefill — the same outcome as
    // no model, and never an error a person has to read.
    const create = vi.fn<(options?: unknown) => Promise<never>>(async () => {
      throw new Error(CHROME_REFUSAL)
    })
    stubModel({ availability: async () => 'available', create: create as unknown as Stub['create'] })

    expect(await promptForObject('go', schema)).toBeNull()
    expect(create).toHaveBeenCalledTimes(SESSION_OPTIONS.length)
  })
})

/**
 * The MTP finding, measured in Chrome on 2026-09-02.
 *
 * The same build that REQUIRES sampling options because speculative decoding
 * is on also REFUSES `responseConstraint` for the same reason:
 *
 * > *Failed to execute 'prompt' on 'LanguageModel': Constrained decoding
 * > (responseConstraint) cannot be used with speculative decoding (MTP).*
 *
 * So PEE-5's premise — that a manifest's declaration can always be the
 * constraint — is false on that build, and a consumer that knows only the
 * constrained path gets nothing.
 */
describe('falling back when the browser refuses constrained decoding', () => {
  const schema = { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } } }
  const MTP_REFUSAL =
    "Failed to execute 'prompt' on 'LanguageModel': Constrained decoding (responseConstraint) cannot be used with speculative decoding (MTP)."

  /** Refuses any constrained prompt, answers an unconstrained one. */
  function mtpModel(reply: string) {
    const prompt = vi.fn(async (_input: string, options?: { responseConstraint?: object }) => {
      if (options?.responseConstraint) throw new Error(MTP_REFUSAL)
      return reply
    })
    stubModel({
      availability: async () => 'available',
      create: async () => ({ prompt, destroy: () => {} }),
    } as unknown as Partial<Stub>)
    return prompt
  }

  it('asks again in words and still returns the object', async () => {
    const prompt = mtpModel('{"title":"Build is broken","description":"since the interop bump"}')
    expect(await promptForObject('go', schema)).toEqual({
      title: 'Build is broken',
      description: 'since the interop bump',
    })
    expect(prompt).toHaveBeenCalledTimes(2)
    // The retry carries no constraint, and names the same fields in words.
    expect(prompt.mock.calls[1]?.[1]).toBeUndefined()
    expect(prompt.mock.calls[1]?.[0]).toContain('title, description')
  })

  it('survives a code fence, which is what an unconstrained model does', async () => {
    mtpModel('```json\n{"title":"Build is broken"}\n```')
    expect(await promptForObject('go', schema)).toEqual({ title: 'Build is broken' })
  })

  it('survives a leading sentence', async () => {
    mtpModel('Sure! Here is the object: {"title":"Build is broken"} Hope that helps.')
    expect(await promptForObject('go', schema)).toEqual({ title: 'Build is broken' })
  })

  it('returns null for prose with no object, rather than inventing one', async () => {
    mtpModel('The team seems to be discussing a broken build.')
    expect(await promptForObject('go', schema)).toBeNull()
  })

  it('tries the constrained path FIRST, so a capable browser is never degraded', async () => {
    const prompt = vi.fn(async () => '{"title":"x"}')
    stubModel({ availability: async () => 'available', create: async () => ({ prompt, destroy: () => {} }) } as unknown as Partial<Stub>)
    await promptForObject('go', schema)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect((prompt.mock.calls[0] as unknown[])[1]).toEqual({ responseConstraint: schema })
  })
})

describe('looseParse and jsonHint', () => {
  it('names exactly the schema keys, so asked-for cannot drift from drawn', () => {
    expect(jsonHint({ type: 'object', properties: { title: {}, description: {} } })).toContain('title, description')
  })

  it('unwraps a lone object an unconstrained model put in an array', () => {
    // It has still answered. `usablePrefill` filters the keys either way.
    expect(looseParse('[{"title":"x"}]')).toEqual({ title: 'x' })
  })

  it('refuses several objects, which is a different answer rather than a wrapped one', () => {
    expect(looseParse('[{"title":"a"},{"title":"b"}]')).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(looseParse(null)).toBeNull()
    expect(looseParse('')).toBeNull()
  })
})

/**
 * Two complaints Chrome logged on every launcher open, observed in production
 * on 2026-09-02:
 *
 * > *The sampling options are incompatible with speculative decoding (MTP)…*
 * > *No output language was specified in a LanguageModel API request…*
 *
 * Both were true of a bare `availability()`, and both were ours. The existing
 * tests passed throughout because their stubs ignore arguments — the same
 * blind spot that hid the `create()` bug. These assert the argument.
 */
describe('availability is asked with the options a session would use', () => {
  it('passes them, rather than asking a question it will not act on', async () => {
    const availability = vi.fn<(options?: unknown) => Promise<string>>(async () => 'available')
    stubModel({ availability: availability as unknown as Stub['availability'] })

    await prefillAvailability()
    expect(availability).toHaveBeenCalledWith(SESSION_OPTIONS[0])
  })

  it('falls back to the bare call on a build that rejects options', async () => {
    // An answer with a warning beats no answer.
    const availability = vi.fn<(options?: unknown) => Promise<string>>(async (options) => {
      if (options) throw new TypeError('availability takes no arguments')
      return 'available'
    })
    stubModel({ availability: availability as unknown as Stub['availability'] })

    expect(await prefillAvailability()).toBe('available')
    expect(availability).toHaveBeenCalledTimes(2)
    expect(availability.mock.calls[1]?.[0]).toBeUndefined()
  })

  it('is unavailable when both spellings throw', async () => {
    const availability = vi.fn<(options?: unknown) => Promise<string>>(async () => {
      throw new Error('no')
    })
    stubModel({ availability: availability as unknown as Stub['availability'] })

    expect(await prefillAvailability()).toBe('unavailable')
  })
})
