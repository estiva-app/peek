import type { ConversationMessage } from '@/lib/conversationRegistry'

/**
 * A row in the `[` picker: a message on screen. A topic to reference was the
 * other kind until FOL-23 removed the Convex topics.
 */
export type FilesMenuItem = { kind: 'message'; data: ConversationMessage }

/** Where the picker will find one message among many on screen. */
const MESSAGE_LIMIT = 6

function matches(item: FilesMenuItem, q: string): boolean {
  // By what was said or who said it — "what Ada said" is found either way.
  return item.data.body.toLowerCase().includes(q) || item.data.author.toLowerCase().includes(q)
}

/**
 * What the menu would draw for this query.
 *
 * It lives in its own file, beside the type it works on, because **the popup
 * has to know whether there is anything to draw before it opens a panel**
 * (D47): the panel is the package `Popover`'s now, and one wrapped around a
 * menu that returned null is a bare box hanging in the air — where the old
 * hand-built container simply held nothing and was invisible. `FilesMenu.tsx`
 * only exports a component, so this could not go there without the app's own
 * lint rule objecting, and it is the rule's point: a file of rendering and a
 * file of rules are different things.
 */
export function filterFilesItems(items: FilesMenuItem[], query: string): FilesMenuItem[] {
  const q = query.toLowerCase()
  const shown = q ? items.filter((i) => matches(i, q)) : items
  // Capped, newest last as the thread shows them: a thread is unbounded, and a
  // menu that grew with it would be a hundred rows of prose.
  return shown.slice(-MESSAGE_LIMIT)
}
