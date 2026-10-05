/** Peek's own name, as its NIP-89 manifest declares it (`src/nostr/manifest.ts`). */
export const PEEK_APP_NAME = 'Peek'

/**
 * The app a file is "in", when that is somewhere other than here — for the
 * "In Estiva Ship" caption under a title. A bare file is named by the app that
 * opens it (interop 0.44), which is Peek for a topic, and "In Peek" inside Peek
 * says nothing (PRO-24: an object is labelled by its type, an app only where it
 * is somewhere else).
 */
export function elsewhereAppName(file: { appName?: string } | null | undefined): string | undefined {
  return file?.appName && file.appName !== PEEK_APP_NAME ? file.appName : undefined
}

/**
 * What an object is, for a label: its noun ("Topic", "Issue"), or the app it is
 * in when that app names none — and nothing for a noun-less object of Peek's
 * own (a message), which is neither "Peek" nor a file.
 */
export function objectLabel(object: { noun?: string; appName?: string }): string | undefined {
  if (object.noun) return object.noun.charAt(0).toUpperCase() + object.noun.slice(1)
  return elsewhereAppName(object)
}

/** What a file is, for a heading: its noun ("Topic", "Issue"), or the app it is in, or "File". */
export function fileHeading(file: { noun?: string; appName?: string }): string {
  return objectLabel(file) ?? 'File'
}
