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

/** What a file is, for a heading: its noun ("Topic", "Issue"), or the app it is in, or "File". */
export function fileHeading(file: { noun?: string; appName?: string }): string {
  if (file.noun) return file.noun.charAt(0).toUpperCase() + file.noun.slice(1)
  return elsewhereAppName(file) ?? 'File'
}
