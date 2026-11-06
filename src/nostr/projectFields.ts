import { fieldsOptedIn, projectFieldsOf, relayFileReadsOf, type ProjectFields, type RelayFileReads } from '@estiva-app/protocol'
import { RELAY_URL } from '@/api/relayUrl'

/** The kind a project is written as: the type the switch names, protocol's `PROJECT_TYPE` (TYPES.md). */
export const PROJECT_KIND = 30850

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

/** The relay's NIP-11 document, which needs no sign-in; `null` in a build with no relay (tests, Storybook). */
async function relayInfo(): Promise<unknown> {
  if (!RELAY_URL) return null
  const res = await fetch(RELAY_URL, { headers: { accept: 'application/nostr+json' } })
  if (!res.ok) throw new Error(`relay information failed: ${res.status}`)
  return res.json()
}

/** What the switch reads off NIP-11: on or off, and the types the relay keeps in order. */
interface Switch {
  fields: ProjectFields | undefined
  inOrder: readonly string[]
  /** The relay answers the list read (NIP-11 `file_list.newest`), switched or not. */
  list: boolean
}

const OFF: Switch = { fields: undefined, inOrder: [], list: false }

let held: Promise<Switch> | undefined

function relaySwitch(): Promise<Switch> {
  // Asked inside the promise, so a read that throws is off, as a refused one is; asked again on the next read.
  held ??= Promise.resolve()
    .then(relayInfo)
    .then(
      (info) => {
        if (info === null) {
          held = undefined
          return OFF
        }
        const reads: RelayFileReads = relayFileReadsOf(info)
        return { fields: projectFieldsOf(reads, fieldsOptIn()), inOrder: reads.inOrder, list: reads.list }
      },
      () => {
        held = undefined
        return OFF
      },
    )
  return held
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
 * The types the relay keeps in order (NIP-11 `files.requires_prev`), for interop's `inOrder`: a comment, a Folder
 * command or a reference to a file of one names it by its id as well. Read whether or not this tab is switched,
 * since the relay is what keeps them so.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-named-by-its-id-in-a-capital-and-small-tag.md
 */
export async function inOrderTypes(): Promise<readonly string[]> {
  return (await relaySwitch()).inOrder
}

/** Whether `address` names a project: the one kind the switch covers. */
export function isProject(address: string | undefined): boolean {
  return !!address && address.startsWith(`${PROJECT_KIND}:`)
}

/** Whether `address` is a project read and written by its fields in this tab. */
export async function byFields(address: string | undefined): Promise<boolean> {
  return isProject(address) && !!(await projectFields())
}

/** The kinds the open read opens, for interop's `openRead`: projects once switched. */
export async function openReadOption(): Promise<{ openRead?: readonly number[] }> {
  return (await projectFields()) ? { openRead: [PROJECT_KIND] } : {}
}

/** `options` with interop's `openRead` once switched, else `options` as handed: off reads exactly as before. */
export async function withOpenRead<T extends object>(options: T | undefined): Promise<T | (T & { openRead: readonly number[] }) | undefined> {
  const { openRead } = await openReadOption()
  return openRead ? ({ ...options, openRead } as T & { openRead: readonly number[] }) : options
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

/** Forget the relay's answer, so a test can switch it. */
export function forgetProjectFields(): void {
  held = undefined
}
