/**
 * Sample data for Storybook stories ONLY.
 *
 * Stories need realistic args without reaching into '@/data/*' directly
 * (the Phase 1 exit criterion bans mock imports from components, and
 * stories live there). Nothing in the app runtime may import this module.
 */
import type { FolderSummary, ForeignObject } from '@estiva-app/interop'

export { TOPIC_HUDDLES } from '@/data/huddleData'
export { SCREENER_ITEMS } from '@/data/screenerData'
export { TOPICS, TOPIC_CONVERSATIONS } from '@/data/topicData'
export { REPLIES } from '@/data/replyData'

/**
 * Not invented, unlike everything above it: one real Ship issue, resolved from
 * 1,074 recorded production events through Peek's own `resolveObjectAsViewer`.
 * It is here so no story reaches into '@/data/*' by hand (UIG-17), and because
 * a recording is the one fixture that cannot drift from what the relay sends.
 */
export { default as RECORDED_SHIP_ISSUE } from '@/data/recordedShipIssue.json'

/**
 * One Ship project, standing in for the file a topic starts under or that a
 * person moves between Folders. Shared because two dialogs need the same one:
 * `StartTopicDialog` names it as the parent, `MoveFileDialog` moves it.
 */
export const SHIP_PROJECT = {
  ref: '30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:0ebd5fdd',
  address: '30850:b38fd2687b17bbde2e8079577cba601936acfe1b731d2d2ba7cdef29a063db46:0ebd5fdd',
  naddr: 'naddr1',
  eventId: 'e',
  kind: 30850,
  widget: 'card',
  appName: 'Estiva Ship',
  slots: { title: { value: 'Folders: navigation for the whole suite' } },
  meta: [],
  comments: [],
  actions: [],
} as unknown as ForeignObject

/** The Folder `SHIP_PROJECT` is filed in — so a picker can leave it out. */
export const FOLDER_HERE = '85db5b59-9e49-4ea1-8e93-3d2a2d78c048'

/**
 * Four Folders, holding the two cases that shape a picker: the one the file is
 * already in, which is never offered, and one with no name at all — a Folder
 * whose channel an app made carries no state event, so its id is what a reader
 * gets.
 */
export const PICKER_FOLDERS = [
  { id: FOLDER_HERE, name: 'Folders' },
  { id: '2303e8c1-c866-43b8-9b4c-e263f313a683', name: 'Feedback on Peek' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Performance & infrastructure' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000002' },
] as FolderSummary[]
