import { channelDestination } from './legacyTopicLinks'

/**
 * Where a Folder opens — the Folder page's shape, decided for FOL-21.
 *
 * A Folder opens on `/app/folders/<id>`, the listing with its management
 * actions — except a Folder that was one of Peek's old topics, whose channel
 * *is* the Folder: it opens on the file its conversation moved to, as every
 * old topic link does (FOL-26). That is `legacyTopicLinks`' table, shipped in
 * the bundle, which is why this no longer reads Convex's `topics.list`
 * (FOL-23).
 *
 * Still a hook, so its callers keep their shape.
 */
export function useFolderPath(): (folderId: string) => string {
  return channelDestination
}
