import {
  DOCUMENT_TYPE,
  FILE_KINDS,
  ISSUE_TYPE,
  PROJECT_TYPE,
  TOPIC_TYPE,
  fieldsOptedIn,
  fileFieldsOf,
  projectFieldsOf,
  relayFileReadsOf,
  typeFieldsOptedIn,
  type ProjectFields,
  type RelayFileReads,
} from '@estiva-app/protocol'
import { forgetRelayInfo, relayInfo } from './relayInfo'

/** The kind a project is written as: the type the switch names, protocol's `PROJECT_TYPE` (TYPES.md). */
export const PROJECT_KIND = 30850
/** The kind an issue is written as: protocol's `ISSUE_TYPE`, switched on its own (ISS-6). */
export const ISSUE_KIND = 30851
/** The kind a topic is written as: protocol's `TOPIC_TYPE`, switched with documents on the relay (ALL-5). */
export const TOPIC_KIND = 30840
/** The kind a page is written as: protocol's `DOCUMENT_TYPE` (ALL-5). */
export const DOCUMENT_KIND = 30842

const OPT_IN_KEY = 'peek.projectFields'

function tabStorage(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

/**
 * This tab's opt-in to reading projects by their fields (ALO-6): `?fields=on|off` in the address Peek opened with,
 * kept for the tab only (protocol's `fieldsOptedIn`). Called once in `main.tsx` before sign-in can move the address,
 * then read from the tab's storage.
 */
export function fieldsOptIn(search = ''): boolean {
  return fieldsOptedIn(search, tabStorage(), OPT_IN_KEY)
}

/**
 * This tab's opt-in to reading and writing issues by their fields (ISS-6): `?issueFields=on|off`, kept for the tab,
 * as Ship's and Leaf's. Issues are switched on their own, never because projects are.
 */
export function issueFieldsOptIn(search = ''): boolean {
  return typeFieldsOptedIn(ISSUE_TYPE, search, tabStorage())
}

/**
 * This tab's opt-in to writing topics in order (ALL-5): `?topicFields=on|off`, kept for the tab, as Leaf's. The relay
 * keeps topics and pages in order team by team before it does everywhere, and its NIP-11 names no single team, so a
 * tab on such a team opts in.
 */
export function topicFieldsOptIn(search = ''): boolean {
  return typeFieldsOptedIn(TOPIC_TYPE, search, tabStorage())
}

/** This tab's opt-in to writing pages in order (ALL-5): `?documentFields=on|off`, kept for the tab, as Leaf's. */
export function documentFieldsOptIn(search = ''): boolean {
  return typeFieldsOptedIn(DOCUMENT_TYPE, search, tabStorage())
}

/** What the switch reads off NIP-11: on or off, and the types the relay keeps in order. */
interface Switch {
  fields: ProjectFields | undefined
  /** Issues' own switch (ISS-6): on where the relay keeps issues in order, or this tab opted in. */
  issues: ProjectFields | undefined
  /** Topics' switch (ALL-5): on where the relay keeps topics in order, or this tab opted in. */
  topics: ProjectFields | undefined
  /** Pages' switch (ALL-5), the same. */
  documents: ProjectFields | undefined
  /** The types the relay announces it keeps in order, and each type this tab opted in to. */
  inOrder: readonly string[]
  /** The relay answers the list read (NIP-11 `file_list.newest`), switched or not. */
  list: boolean
  /** It also returns a named file's current text with it (`file_list.text`): the open read. */
  text: boolean
  /** It answers when files changed without the changes (`file_list.times`): the times read. */
  times: boolean
}

const OFF: Switch = { fields: undefined, issues: undefined, topics: undefined, documents: undefined, inOrder: [], list: false, text: false, times: false }

let held: Promise<Switch> | undefined
/** What `held` answered, for a caller that cannot wait a turn (a dialog's first words): undefined until it is in. */
let answered: Switch | undefined

function relaySwitch(): Promise<Switch> {
  if (held) return held
  // Asked inside the promise, so a read that throws is off, as a refused one is; asked again on the next read.
  const asked = Promise.resolve()
    .then(relayInfo)
    .then(
      (info) => {
        if (info === null) {
          held = undefined
          return OFF
        }
        const reads: RelayFileReads = relayFileReadsOf(info)
        const fields = projectFieldsOf(reads, fieldsOptIn())
        const issues = fileFieldsOf(reads, ISSUE_TYPE, issueFieldsOptIn())
        const topics = fileFieldsOf(reads, TOPIC_TYPE, topicFieldsOptIn())
        const documents = fileFieldsOf(reads, DOCUMENT_TYPE, documentFieldsOptIn())
        // A type this tab writes in order is named by its id and deleted by its field, announced or opted in to.
        const switched = [
          ...(fields ? [PROJECT_TYPE] : []),
          ...(issues ? [ISSUE_TYPE] : []),
          ...(topics ? [TOPIC_TYPE] : []),
          ...(documents ? [DOCUMENT_TYPE] : []),
        ]
        return {
          fields,
          issues,
          topics,
          documents,
          inOrder: [...new Set([...reads.inOrder, ...switched])],
          list: reads.list,
          text: reads.text,
          times: reads.times,
        }
      },
      () => {
        held = undefined
        return OFF
      },
    )
  held = asked
  // Kept only while it is the answer in use: a read that failed, or one forgotten since, leaves nothing behind.
  void asked.then((answer) => {
    if (held === asked) answered = answer
  })
  return asked
}

/**
 * Whether Peek reads and writes projects by their fields (ALO-6, SPEC §6.13): Ship's and Leaf's switch, protocol's
 * one rule for the three apps — the relay announces it, or this tab opted in. The relay's NIP-11 is read once per
 * page. Undefined is off: read and write as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export async function projectFields(): Promise<ProjectFields | undefined> {
  return (await relaySwitch()).fields
}

/**
 * The types kept in order, for interop's `inOrder`: those the relay announces (NIP-11 `files.requires_prev`), whether
 * or not this tab is switched, and each type this tab opted in to, since a relay that keeps a type in order for one
 * team announces none (ALL-5). A comment, a Folder command or a reference to a file of one names it by its id as
 * well, and a Delete declared as a `kind:5` marks the file deleted.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-named-by-its-id-in-a-capital-and-small-tag.md
 */
export async function inOrderTypes(): Promise<readonly string[]> {
  return (await relaySwitch()).inOrder
}

/** Whether issues are read and written by their fields in this tab (ISS-6); undefined is off. */
export async function issueFields(): Promise<ProjectFields | undefined> {
  return (await relaySwitch()).issues
}

/**
 * Whether topics are written in order in this tab (ALL-5); undefined is off: a change names none it follows and a
 * delete is the NIP-09 one, as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/every-file-type-is-kept-in-order-and-a-delete-only-marks-the-file.md
 */
export async function topicFields(): Promise<ProjectFields | undefined> {
  return (await relaySwitch()).topics
}

/** Whether pages are written in order in this tab (ALL-5); undefined is off. */
export async function documentFields(): Promise<ProjectFields | undefined> {
  return (await relaySwitch()).documents
}

/** The switch of `kind`: a project's, an issue's, a topic's or a page's, each on its own; undefined for any other kind, or off. */
export async function fieldsFor(kind: number | undefined): Promise<ProjectFields | undefined> {
  if (kind === PROJECT_KIND) return projectFields()
  if (kind === ISSUE_KIND) return issueFields()
  if (kind === TOPIC_KIND) return topicFields()
  if (kind === DOCUMENT_KIND) return documentFields()
  return undefined
}

/** Whether `kind` has a switch of its own: a project, an issue, a topic or a page. */
export function isSwitchedKind(kind: number | undefined): boolean {
  return kind === PROJECT_KIND || kind === ISSUE_KIND || kind === TOPIC_KIND || kind === DOCUMENT_KIND
}

/** Whether `address` names a project. */
export function isProject(address: string | undefined): boolean {
  return !!address && address.startsWith(`${PROJECT_KIND}:`)
}

/** Whether `address` is a project or an issue read and written by its fields in this tab. */
export async function byFields(address: string | undefined): Promise<boolean> {
  const kind = address ? Number(address.split(':')[0]) : undefined
  return !!(await fieldsFor(kind))
}

/** {@link byFields} without the wait, for the first words of a dialog: undefined until the relay's answer is in. */
export function byFieldsNow(address: string | undefined): boolean | undefined {
  if (!answered) return undefined
  const kind = address ? Number(address.split(':')[0]) : undefined
  if (kind === PROJECT_KIND) return !!answered.fields
  if (kind === ISSUE_KIND) return !!answered.issues
  if (kind === TOPIC_KIND) return !!answered.topics
  if (kind === DOCUMENT_KIND) return !!answered.documents
  return false
}

/**
 * The kinds the open read opens, for interop's `openRead`: projects once switched, and every other file kind — topics,
 * documents, issues — as soon as the relay offers the open read (NIP-11 `file_list` newest and text), switched or
 * not, since reading needs no order kept (ALO-13). A file it does not answer is read as before. Before, Peek's cold
 * open read every change of each topic, document and issue it drew: 13.8 of Miky's 18.9 MB on 11 Nov.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/opening-a-file-reads-its-current-text-not-its-history.md
 */
export async function openReadOption(): Promise<{ openRead?: readonly number[] }> {
  const relay = await relaySwitch()
  const kinds = [
    ...(relay.fields ? [PROJECT_KIND] : []),
    ...(relay.list && relay.text ? FILE_KINDS.filter((kind) => kind !== PROJECT_KIND) : []),
  ]
  return kinds.length ? { openRead: kinds } : {}
}

/**
 * `options` with interop's `openRead` ({@link openReadOption}), and, for an `archivedWith` read, its `listRead` as soon as the
 * relay offers the list read, switched or not: each parent the walk reads costs its current values, not every change
 * (ALO-15). Otherwise `options` as handed: off reads exactly as before.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-relay-advertises-the-list-read-apart-from-the-switch.md
 */
export async function withOpenRead<T extends { archivedWith?: boolean; archivedChildren?: boolean }>(
  options: T | undefined,
): Promise<T | (T & { openRead?: readonly number[]; listRead?: true }) | undefined> {
  const [{ openRead }, listRead] = await Promise.all([
    openReadOption(),
    options?.archivedWith ? listReadOffered() : Promise.resolve(false),
  ])
  if (!openRead && !listRead) return options
  return { ...options, ...(openRead ? { openRead } : {}), ...(listRead ? { listRead: true as const } : {}) } as T & {
    openRead?: readonly number[]
    listRead?: true
  }
}

/** The list read, for interop's `listRead`: once switched. */
export async function listReadOption(): Promise<{ listRead?: true }> {
  return (await projectFields()) ? { listRead: true } : {}
}

/**
 * Whether the relay answers the list read (SPEC §6.13), whether or not this tab is switched: it leaves a deleted file
 * out, which is how Archive → Deleted finds every deleted project in two reads.
 */
export async function listReadOffered(): Promise<boolean> {
  return (await relaySwitch()).list
}

/** Whether the relay answers the times read (SPEC §6.13, NIP-11 `file_list.times`), switched or not. */
export async function timesOffered(): Promise<boolean> {
  return (await relaySwitch()).times
}

/** Forget the relay's answer, so a test can switch it. */
export function forgetProjectFields(): void {
  held = undefined
  answered = undefined
  forgetRelayInfo()
}
