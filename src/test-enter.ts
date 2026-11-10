import userEvent from '@testing-library/user-event'

/**
 * Puts `text` into a field in one input event, the way a paste does.
 *
 * `userEvent.type` fires a keydown, input and keyup per character and waits a
 * tick after each, so a 20-character query re-renders the CommandLauncher 20
 * times; that was most of the launcher suites' time (PER-18). Use this where
 * the test is about what the field holds, and keep `userEvent.type` where the
 * keystrokes themselves are what is under test.
 *
 * Throws rather than letting the text land nowhere: a case asserting that a
 * row is absent would otherwise pass on an empty field.
 */
export async function enter(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  await userEvent.click(field)
  await userEvent.paste(text)
  if (!field.value.endsWith(text)) throw new Error(`enter: the field holds "${field.value}", not "${text}"`)
}
