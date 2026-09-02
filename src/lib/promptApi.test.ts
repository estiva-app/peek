/**
 * PEE-6 — the gate, and the download that must never start by accident.
 *
 * The population that gets prefill is: recent desktop Chrome, with 22 GB free
 * and either >4 GB VRAM or 16 GB RAM, **after a download has completed**.
 * Everyone else gets the form. So the interesting assertions here are the
 * negative ones — what this does *not* do on the machines that cannot run it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SAMPLING, canPrefill, prefillAvailability, promptForObject } from './promptApi'

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

describe('canPrefill', () => {
  it('is true only for a model already on the machine', async () => {
    stubModel({ availability: async () => 'available' })
    expect(await canPrefill()).toBe(true)
  })

  it('is FALSE for "downloadable", so opening a form never starts a 22 GB fetch', async () => {
    /*
      The assertion this file exists for. `'downloadable'` means the model
      could be fetched — and treating that as "yes" would make filing an issue
      the trigger for a multi-gigabyte download nobody asked for. A person who
      wants the model gets it from a Chrome affordance that says so.
    */
    stubModel({ availability: async () => 'downloadable' })
    expect(await canPrefill()).toBe(false)
  })

  it('is false while a download is already in flight', async () => {
    // Nothing blocks on it (PEE-6), so a form opened mid-download is simply a
    // form.
    stubModel({ availability: async () => 'downloading' })
    expect(await canPrefill()).toBe(false)
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

  it('returns null for an array, which means the constraint was not applied', async () => {
    // Guessing at it would put invented values in a form somebody is about to
    // publish from.
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
    expect(passed).toEqual(SAMPLING[0])
  })

  it('asks for the most predictable output, because it fills a form to be published', async () => {
    // Sampling creatively over a colleague's conversation is not a feature.
    expect(SAMPLING[0]).toEqual({ samplingMode: 'most-predictable' })
  })

  it('falls back when a build refuses the first spelling', async () => {
    /*
      `{temperature: 0, topK: 1}` was refused in the same measurement that
      refused no-options, so the list is tried in order rather than assumed.
    */
    const create = vi.fn(async (options: unknown) => {
      if (JSON.stringify(options) === JSON.stringify(SAMPLING[0])) throw new Error(CHROME_REFUSAL)
      return { prompt: async () => '{"title":"x"}', destroy: () => {} }
    })
    stubModel({ availability: async () => 'available', create: create as unknown as Stub['create'] })

    expect(await promptForObject('go', schema)).toEqual({ title: 'x' })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[1]?.[0]).toEqual(SAMPLING[1])
  })

  it('gives up quietly when every spelling is refused', async () => {
    // A browser that accepts none simply gets no prefill — the same outcome as
    // no model, and never an error a person has to read.
    const create = vi.fn<(options?: unknown) => Promise<never>>(async () => {
      throw new Error(CHROME_REFUSAL)
    })
    stubModel({ availability: async () => 'available', create: create as unknown as Stub['create'] })

    expect(await promptForObject('go', schema)).toBeNull()
    expect(create).toHaveBeenCalledTimes(SAMPLING.length)
  })
})
