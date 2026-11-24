import { DOCUMENT_TYPE, ISSUE_TYPE, PROJECT_TYPE, TOPIC_TYPE, relayFileReadsOf } from '@estiva-app/protocol'
import { forgetRelayInfo, relayInfo } from './relayInfo'

/** The kind a project is written as: protocol's `PROJECT_TYPE` (TYPES.md). */
export const PROJECT_KIND = 30850
/** The kind an issue is written as: protocol's `ISSUE_TYPE`. */
export const ISSUE_KIND = 30851
/** The kind a topic is written as: protocol's `TOPIC_TYPE`. */
export const TOPIC_KIND = 30840
/** The kind a page is written as: protocol's `DOCUMENT_TYPE`. */
export const DOCUMENT_KIND = 30842

const KIND_OF_TYPE: Readonly<Record<string, number>> = {
  [PROJECT_TYPE]: PROJECT_KIND,
  [ISSUE_TYPE]: ISSUE_KIND,
  [TOPIC_TYPE]: TOPIC_KIND,
  [DOCUMENT_TYPE]: DOCUMENT_KIND,
}

let held: Promise<readonly number[]> | undefined

/**
 * The base kinds the relay finds by the words of their current fields (NIP-11 `file_search.types`), for `[`'s search
 * tier. The relay's NIP-11 is read once per page; a read that fails answers none and is asked again next time.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/search-finds-a-file-by-the-words-of-its-current-fields.md
 */
export function searchedKinds(): Promise<readonly number[]> {
  if (held) return held
  const asked = Promise.resolve()
    .then(relayInfo)
    .then(
      (info) => {
        if (info === null) held = undefined
        return relayFileReadsOf(info).search.flatMap((type) => (type in KIND_OF_TYPE ? [KIND_OF_TYPE[type]] : []))
      },
      () => {
        held = undefined
        return []
      },
    )
  held = asked
  return asked
}

/** Forget the relay's answer, so a test can change it. */
export function forgetSearchedKinds(): void {
  held = undefined
  forgetRelayInfo()
}
