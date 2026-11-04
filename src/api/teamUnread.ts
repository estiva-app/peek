import type { FolderSummary } from '@estiva-app/interop'
import type { StreamMessage } from '@/nostr/channelStreams'
import { fileContext } from '@estiva-app/conversation'

/**
 * Each Folder's messages, with a moved file's talk handed to the Folder it
 * now lives in (FOL-49).
 *
 * The read is by `h` (`channelStreams.ts`), and a move does not change `h`:
 * FOL-7 re-parents a file by `kind:1852` alone, and its conversation stays in
 * the channel it was filed in. So a file talked about in one Folder's channel
 * and listed by another's state belongs to the other — the Folder it is drawn
 * under — and its stream is judged there.
 *
 * Moved only out of a Folder **with state** that does not list the file. A
 * Folder read by containment lists whatever carries its `h`, so it has not
 * lost the file; and a stateless channel — a Ship project's record channel —
 * is already folded into the team that lists it (`listedIn`, FOL-22), which a
 * move updates.
 *
 * A file no state lists lives where its **parent** does (FOL-50): that is every
 * issue, which no Folder lists and which is reached through its project. So an
 * issue's talk follows its project out of a Folder exactly as the project's
 * own does, and it is still the issue's stream — keyed by the issue's address,
 * judged by its marker — that is handed over. `parents` is what
 * {@link unlistedFiles} asked about; a file with no parent there, or whose
 * parent no state lists either, stays where it is talked about. One step up,
 * not a walk: an issue's project is a file a state lists, and nothing on
 * production nests deeper under a Folder's talk.
 *
 * A message naming a moved file and one that stayed is in both Folders, each
 * with only the files that live there. A Folder the caller holds no messages
 * for gets none moved into it: it was not answered, and a few moved messages
 * would pass for a judged Folder with nothing else said in it.
 *
 * `handed` says, per channel, which Folders its talk was moved into: the
 * socket signals by `h`, and an open section's rows (FOL-44) re-read on the
 * Folder the file is drawn under, so the signal has to travel the same way.
 */
export function placeStreams(
  held: Readonly<Record<string, readonly StreamMessage[]>>,
  folders: readonly FolderSummary[],
  parents: Readonly<Record<string, string | null>> = {},
): { streams: Record<string, StreamMessage[]>; handed: Record<string, string[]> } {
  const { lists, listedBy } = statesOf(folders)
  // The listed file a file lives as: itself, else its parent — or none.
  const placeOf = (address: string): string | undefined => {
    if (listedBy.has(address)) return address
    const parent = parents[address]
    return parent && listedBy.has(parent) ? parent : undefined
  }
  const placed: Record<string, StreamMessage[]> = {}
  const handed: Record<string, string[]> = {}
  for (const id of Object.keys(held)) placed[id] = []
  for (const [id, messages] of Object.entries(held)) {
    const state = lists.get(id)
    for (const message of messages) {
      const files = message.about.filter((address) => fileContext(address) !== undefined)
      // Each moved file with the listed file it lives as.
      const moved = new Map<string, string>()
      if (state) {
        for (const address of files) {
          const place = placeOf(address)
          if (place !== undefined && !state.has(place)) moved.set(address, place)
        }
      }
      if (moved.size === 0) {
        placed[id].push(message)
        continue
      }
      const stayed = files.filter((address) => !moved.has(address))
      if (stayed.length > 0) placed[id].push({ ...message, about: stayed })
      const into = new Map<string, string[]>()
      for (const [address, place] of moved) {
        for (const container of listedBy.get(place)!) into.set(container, [...(into.get(container) ?? []), address])
      }
      for (const [container, about] of into) {
        placed[container]?.push({ ...message, about })
        const to = (handed[id] ??= [])
        if (!to.includes(container)) to.push(container)
      }
    }
  }
  return { streams: placed, handed }
}

/**
 * The files {@link placeStreams} needs a parent for: named in a Folder with
 * state, and listed by no state (FOL-50). A file in a stateless channel is
 * never moved out of it, and a listed one is placed by the listing, so asking
 * about either would be a read for nothing.
 */
export function unlistedFiles(
  held: Readonly<Record<string, readonly StreamMessage[]>>,
  folders: readonly FolderSummary[],
): string[] {
  const { lists, listedBy } = statesOf(folders)
  const out = new Set<string>()
  for (const [id, messages] of Object.entries(held)) {
    if (!lists.has(id)) continue
    for (const message of messages) {
      for (const address of message.about) {
        if (fileContext(address) !== undefined && !listedBy.has(address)) out.add(address)
      }
    }
  }
  return [...out].sort()
}

/** Each Folder with state's listing, and every Folder with state that lists each file. */
function statesOf(folders: readonly FolderSummary[]): {
  lists: Map<string, ReadonlySet<string>>
  listedBy: Map<string, string[]>
} {
  const lists = new Map<string, ReadonlySet<string>>()
  const listedBy = new Map<string, string[]>()
  for (const folder of folders) {
    if (!folder.hasState) continue
    lists.set(folder.id, new Set(folder.addresses))
    for (const address of folder.addresses ?? []) {
      const containers = listedBy.get(address) ?? []
      if (!containers.includes(folder.id)) containers.push(folder.id)
      listedBy.set(address, containers)
    }
  }
  return { lists, listedBy }
}

/**
 * Does this Folder hold a file the person is a member of — the `Mine`
 * filter's Folder-level question (FOL-41, CON-19).
 *
 * The sibling of {@link teamHasUnread} and judged over the same messages, so
 * it costs nothing: `useTeamUnread` has already read every Folder's streams to
 * place its dots, and this is one more pass over what is in hand. The tree
 * cannot answer it any other way — a Folder's contents are read when its fold
 * opens, and filtering a hundred and sixty Folders by opening all of them is
 * the whole minute's relay budget.
 *
 * ## What it can and cannot see
 *
 * A Folder has nothing to read (Miky, 2026-10-01), so its own chat is never an
 * answer: only a file the person is a member of is, and a file is visible here
 * only through a message that names it. A file with nothing said in it inside
 * the 90-day horizon (§11.6) leaves no trace in these streams and its Folder
 * is not listed. That is the same horizon the dots are judged by, and a file
 * nobody has said anything in has nothing for the filter to lead to — but it
 * is a real limit, not a rounding, and `All` is one click away.
 */
export function teamHasMemberStream(messages: readonly StreamMessage[], isMember: (key: string) => boolean): boolean {
  for (const message of messages) {
    for (const address of message.about) {
      // The same test `teamHasUnread` streams by: an `a` that is not an address
      // names no stream, and the message belongs to the general one.
      if (fileContext(address) !== undefined && isMember(address)) return true
    }
  }
  return false
}
