/**
 * PEE-6 — the gate, and the download that must never start by accident.
 *
 * The population that gets prefill is: recent desktop Chrome, with 22 GB free
 * and either >4 GB VRAM or 16 GB RAM, **after a download has completed**.
 * Everyone else gets the form. So the interesting assertions here are the
 * negative ones — what this does *not* do on the machines that cannot run it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canPrefill, prefillAvailability, promptForObject } from './promptApi'

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
