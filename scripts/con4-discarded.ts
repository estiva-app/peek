/**
 * Topics the migration does not carry, and the five team Folders it carries
 * everything else into.
 *
 * A discard is a decision, not a measurement, so it lives in one place that
 * both the census (`probe-shr8-census.ts`) and the file run
 * (`con4-topic-files.ts`) read. The census subtracts these rows from the gap
 * and says so in its output; without that, the gap never reaches 0 and every
 * later reader has to be told by hand why 23 of it is fine.
 */

/** The five, by id — FOL-20, 2026-09-14. */
export const TEAMS = {
  'Estiva HQ': '05bebd5b-b699-4bd4-af50-f5377df0fd67',
  Peek: 'fd03975a-eb00-49d6-a4b7-33ead1854672',
  Ship: '3167adea-877f-43c4-96fb-517a2b2d5d24',
  Leaf: '05ed05b2-0687-4be9-a096-7ab21d79fad4',
  Steer: '6f1b5cce-96ae-4817-bac2-89a1bd142576',
} as const

/**
 * Convex topic title → why its content is not migrated.
 *
 * Keyed by the Convex title verbatim, which is what the census surfaces are
 * named after (`topic/<title>`).
 */
export const DISCARDED: Record<string, string> = {
  'For testing': [
    'Discarded (Miky, CON-4, 2026-09-22). 23 messages: 6 never published and 17',
    'published into channel 3789d2ca, which PEE-30 soft-deleted — a 9008 hides',
    'every message under its h, to an ids: lookup included, so the 17 are',
    'unreadable and stay so; the channel had no 30840 file and is not getting',
    'one. The content is what the title says. "Nothing obsolete stays on the',
    'relay" (2026-09-15), so this is a deliberate loss, not a gap to close.',
  ].join(' '),
}

/**
 * Convex topic title → why the migration's target for it is **not** a `30840`.
 *
 * These rows stay in the gap: they are migrated, just not onto a file. Both
 * are record channels that PEE-31/FOL-25 keep — issues live in them by `h` —
 * and both are live, so their missing messages can be published where the rest
 * of their conversation already is.
 *
 * **The shape is settled (Miky, CON-12, 2026-09-22): a `kind:1111` addressed
 * to the channel's own Ship project.** No new object, no conversation split,
 * and it is exactly the shape a Ship comment on an issue in that channel
 * already has — `A`/`a` the record, `h` the channel. `shr8-migrate.ts`
 * resolves that target itself and no longer skips these two.
 *
 * This map therefore now says only *"not a `30840`"*, which is still what the
 * census and `con4-topic-files.ts` read it for. Seven more record channels
 * take a project target without being named here, because CON-4 only had to
 * list the two that had unpublished rows — the other seven's content is all
 * published, and it was CON-12 that found it unreachable.
 */
export const NO_FILE_TARGET: Record<string, string> = {
  'Feedback on Peek': [
    '33 in the gap. Channel 2303e8c1 is live and staying: it holds the Ship',
    'project 30850:a8a7d739…:2a5b8f13 "Feedback on Peek", 88 published messages',
    'and 33 issues by h. A second object titled "Feedback on Peek" beside the',
    'project would split one conversation in the Peek Folder, so the target is',
    "the project record or the channel itself — the migration ticket's call.",
  ].join(' '),
  'Claude on Estiva / Estiva Steer': [
    '1 in the gap. Channel 925897ad is live and staying: 16 issues by h, 50',
    'published kind:9 and no project record. One message does not earn a file',
    'of its own; publish it where its other 79 are.',
  ].join(' '),
}
