import { IconMessage } from '@tabler/icons-react'
import { EnterHint } from '@estiva-app/ui'
import type { SuggestionPopupOptions } from '@estiva-app/ui/editor'
import { previewText } from '@/lib/textParsing'
import { filterFilesItems, type FilesMenuItem } from './filesMenuItems'

/**
 * The picker `[` opens: the messages on screen (RIC-11). Topics were its other
 * section until FOL-23 removed the Convex topics.
 *
 * It used to offer three sections — Apps (a Figma category you could drill
 * into) and Documents beside Topics — built on invented files. Those only ever
 * appeared in mock mode, so the menu under review was never the menu the app
 * drew, and they were retired with their drill-in level on 2026-09-05
 * (Katerina). `APP_FILES` / `DOCUMENT_FILES` stay in `src/data`: MessageBody
 * still resolves them, so file references in messages already sent keep
 * working, and the `fileMention` node they insert into is untouched.
 *
 * Messages are the second section that note said would return "as a
 * `MenuSection` beside this one — not as the two-level drill-in". A message is
 * a file in the sense that matters here (Miky, 2026-09-02: *"everything you
 * mention … is basically a file. Even things like different topic, message, or
 * even specific person"*), and it is offered from the same key.
 *
 * The list is the package's `SuggestionMenu` since UIG-31 (estiva-ui 0.45.0),
 * drawn by `suggestionPopup` in `mention.tsx`; this says which rows and how
 * each looks. The arrows wrap at the ends now, as the `/` menu's always did.
 */
export type { FilesMenuItem } from './filesMenuItems'

export const FILES_MENU: SuggestionPopupOptions<FilesMenuItem> = {
  ariaLabel: 'Topics and messages',
  width: 'w-[658px]',
  maxHeight: 'max-h-[360px]',
  sections: (items, query) => [{ label: 'Messages', items: filterFilesItems(items, query), className: 'px-2' }],
  itemKey: (item) => `message-${item.data.eventId ?? item.data.id}`,
  row: (item) => ({
    leading: <IconMessage size={16} stroke={1.5} className="text-text-secondary" />,
    // The author and the opening words, marks stripped — the same caption the
    // chip wears once picked, so nothing changes shape.
    label: `${item.data.author}: ${previewText(item.data.body)}`,
    hint: <EnterHint />,
  }),
}
