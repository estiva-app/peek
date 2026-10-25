import { KIND_CHANNEL_METADATA, type ArchiveImpact } from '@estiva-app/interop'
import { archivedLine } from '@estiva-app/ui'
import { currentRouteWords, type RouteWords } from '@/lib/objectUrl'

/**
 * The name of a kind in a sentence — "issue", "topic", "folder" (FOL-46).
 *
 * Read off the word the kind's manifest declares for its links (§7.7), so Peek
 * names Ship's kinds without knowing them: `/issue/` makes an issue. A Folder
 * is a Folder, and a kind nobody gave a word is a file.
 */
export function kindNoun(kind: number, words: RouteWords = currentRouteWords()): string {
  if (kind === KIND_CHANNEL_METADATA) return 'folder'
  return words.byKind[kind] ?? 'file'
}

/**
 * The line in the comment box's place on an archived file, the same in every
 * app: "Archived. Unarchive it to comment.", or the closest archived file
 * above it named by its kind — "Unarchive the project to comment."
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-archived-with-the-closest-archived-file-above-it.md
 */
export function archivedLineOf(archive: { with?: string } | undefined, words?: RouteWords): string | undefined {
  return archivedLine(archive, archive?.with ? kindNoun(Number(archive.with.split(':')[0]), words) : undefined)
}

/** "14 issues", "1 topic". */
export function countOf(kind: number, n: number, words?: RouteWords): string {
  const noun = kindNoun(kind, words)
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * What archiving hides, worded for the warning: interop's counts, so Peek and
 * Ship say the same numbers, in Peek's words.
 *
 * `hides` is each kind counted — "its 14 issues" reads as "14 issues";
 * `staysVisible` groups what another Folder lists too by that Folder, as Ship
 * does: "2 files also in Estiva HQ".
 */
export function archiveImpactWords(
  impact: ArchiveImpact,
  words?: RouteWords,
): { hides: string[]; staysVisible: string[] } {
  const hides = impact.hides.map(({ kind, count }) => countOf(kind, count, words))
  const byFolder = new Map<string, number>()
  for (const file of impact.staysVisible) {
    const name = file.in[0]?.name ?? 'another folder'
    byFolder.set(name, (byFolder.get(name) ?? 0) + 1)
  }
  const staysVisible = [...byFolder].map(([name, n]) => `${n} ${n === 1 ? 'file' : 'files'} also in ${name}`)
  return { hides, staysVisible }
}

/** "a, b and c". */
export function listOf(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}
