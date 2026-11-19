/**
 * CONCEPT — a marked message's item opened in Peek (Miky, 19 Nov: option A). Its label opens it in the 384px column a
 * thread opens in, as Leaf opens it in the comments' place and Ship beside its list: one rule in the three apps. Opened
 * from a reply inside a thread, it takes the thread's place and ← brings the thread back; ✕ closes the column.
 * The item is the same detail Leaf and Ship draw (ItemDetail, copied unchanged), then its own conversation drawn the
 * way Peek draws one, with its own box: the talk that shapes the item, apart from the message's thread
 * (record a-conversation-is-one-shared-thing-and-only-its-colours-are-the-apps).
 */
import { IconArrowLeft, IconX } from '@tabler/icons-react'
import { Card, IconButton, MetaText, Panel, ScrollArea } from '@estiva-app/ui'
import { ReplyCard } from '@/components/ReplyCard'
import { ConversationBox } from '@/components/ui/ConversationBox'
import { ItemContent, ItemFields, ItemIdentity, fromTool } from './ItemDetail'
import { CLAUDE, ITEMS, KATERINA, MIKY, PROJECT, TEAM, type Item, type Person } from './fixtures'
import type { StoryMark } from './messages'
import { whyFor } from './TypedMark'

/** The item a message's mark opens: the fixture of that title, else one made from the mark as Mark as… makes it. */
export function itemOf(mark: StoryMark, message: { text: string; author: Person }, place: string): Item {
  const known = ITEMS.find((i) => i.title === mark.title)
  // Opened from this message, its source is this message, whatever the fixture says.
  const source = { app: 'Peek' as const, what: 'message' as const, place, author: message.author, quote: message.text }
  // Marked by an agent or a loop: the item says why, in the words the guess turned on (Miky, 19 Nov).
  const why = mark.by.bot ? whyFor(message.text) : undefined
  if (known) return { ...known, source, why }
  return {
    id: `peek-${mark.title}`,
    type: mark.type,
    word: mark.word,
    title: mark.title,
    status: mark.status,
    at: 'Today',
    day: '2026-11-19',
    team: TEAM,
    about: { kind: 'project', title: PROJECT },
    markedBy: mark.by,
    why,
    source,
  }
}

/** The item's own conversation, in its own words, as Ship's ItemPanel has it; one marked just now has none yet. */
const talkOn = (item: Item): { id: string; author: Person; ago: string; text: string }[] => {
  if (fromTool(item) || item.id.startsWith('peek-')) return []
  if (item.word === 'Question') return [{ id: 'c1', author: KATERINA, ago: '2h', text: 'C keeps files where people already look for them. I’d start there.' }, { id: 'c2', author: MIKY, ago: '1h', text: 'B reads better for Bugs: Engineering leads it, everyone reads it.' }]
  if (item.word === 'Blocker') return [{ id: 'c1', author: CLAUDE, ago: '1d', text: 'Still blocked: I can’t add Katerina to Design until this is done.' }]
  if (item.type === 'journal') return [{ id: 'c1', author: KATERINA, ago: '20m', text: '@Miky why not keep Folders under each team, folded?' }]
  return [{ id: 'c1', author: KATERINA, ago: '20m', text: 'Agreed, I hit this again today.' }]
}

/** The item in the thread's column: ← back to the thread it was opened from, what it is, the item, then its talk. */
export function ItemBeside({ item, deleted, onBack, onClose }: { item: Item; deleted?: { by: Person; reason?: string }; onBack?: () => void; onClose: () => void }) {
  const talk = talkOn(item)
  // A deleted highlight (Miky, 19 Nov): gone from the thread and every list, and from what agents read; its marker and
  // its message's author open it from Activity, read only, with who deleted it and why.
  const note = deleted && (
    <Card fill="none" attention="warning" className="flex flex-col gap-1 p-3">
      <span className="text-body-2 text-text-primary">Deleted by {deleted.by.name} today</span>
      {deleted.reason && <span className="text-body-2 text-text-secondary">“{deleted.reason}”</span>}
      <span className="text-caption text-text-muted">{`Nobody else sees it any more, and agents no longer read it. Only you and ${deleted.by.name} can open it.`}</span>
    </Card>
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panel
        title={
          <span className="flex min-w-0 items-center gap-1">
            {onBack && (
              <IconButton variant="muted" tooltip="Back to the thread" aria-label="Back to the thread" onClick={onBack}>
                <IconArrowLeft size={16} stroke={1.5} />
              </IconButton>
            )}
            <ItemIdentity item={item} />
          </span>
        }
        actions={
          <IconButton variant="muted" tooltip="Close" aria-label="Close" onClick={onClose}>
            <IconX size={16} stroke={1.5} />
          </IconButton>
        }
      >
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-3 px-4 pb-4">
            {note}
            <span className="text-h3 text-text-primary">{item.title}</span>
            {!deleted && <ItemFields key={item.id} item={item} />}
            <ItemContent key={`${item.id}-${item.status}`} item={item} />
          </div>
          <div className="flex flex-col gap-1 border-t border-border-default px-2 py-3">
            {talk.length ? (
              talk.map((c) => <ReplyCard key={c.id} messageId={c.id} authorName={c.author.name} timestamp={c.ago} body={c.text} canEditAndDelete={false} />)
            ) : (
              <span className="px-2">
                <MetaText tone="muted">No comments yet</MetaText>
              </span>
            )}
          </div>
        </ScrollArea>
        {!deleted && (
          <div className="px-4 pb-4">
            <ConversationBox kind="reply" onSend={async () => ({ accepted: true })} contextLabel={`Comment on this ${item.word}`} />
          </div>
        )}
      </Panel>
    </div>
  )
}
