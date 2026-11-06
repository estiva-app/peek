import { useState } from 'react'
import { IconCheck, IconDotsVertical, IconLayoutDashboard } from '@tabler/icons-react'
import { ArchivedNotice, Button, ConversationLayout, EmptyState, Menu, MenuItem, MenuSeparator, PageHeader, Toolbar, ToolbarButton, WithTooltip, type ConversationItem } from '@estiva-app/ui'
import type { Membership } from '@estiva-app/conversation'
import { ConversationCard } from '@/components/ConversationCard'
import { ClosedBox, ConversationBox } from '@/components/ui/ConversationBox'
import { FileActivityPanelView } from '@/components/FileActivityPanel'
import { Members } from '@/components/Members'
import { OverviewPanel } from '@/components/OverviewPanel'
import { SidePanelButton } from '@/components/SidePanelButton'
import { openWorkKey } from './keys'
import { TopicFiles } from './TopicFiles'
import { DIRECTORY, KEY, messagesOf, NAME, type Person, type Read, type Topic } from './fixtures'

/**
 * **A topic's page** — the middle column and its Overview as `useFilePane` and
 * `useFileView` draw a topic today: the kit's `PageHeader` (title, members
 * pill, one toolbar), the kit's `ConversationLayout` with Peek's own message
 * cards and box, and `OverviewPanel` beside it with the topic's files above
 * Activity. Changed by this project (Miky, 3 and 6 Nov):
 *
 * - **Add to Open work** is a button in the header, with its key; Ctrl/Cmd+O
 *   anywhere on the page does the same (`PeekTopics` listens).
 * - The "⋮" holds **Rename, Move…, Copy link, Archive… and Delete**. Details,
 *   New topic inside, Make it a space and Add to Open work are no longer in it.
 * - The files in the Overview: `TopicFiles` (this folder's copy).
 */
export function TopicPage({ topic, viewer, conversation, files, inOpenWork, onToggleOpenWork }: {
  topic: Topic
  viewer: Person
  /** The conversation's read. */
  conversation: Read
  /** The topic's files' read. */
  files: Read
  inOpenWork: boolean
  onToggleOpenWork: () => void
}) {
  const [overview, setOverview] = useState(true)
  const member = topic.members.includes(viewer)
  // Who can add a file to the topic: its members, while it is not archived.
  const readOnly = !!topic.archived || !member
  const members = new Map<string, Membership>(topic.members.map((p) => [KEY[p], { member: true, since: 1_760_000_000 }]))

  const header = (
    <PageHeader
      title={topic.title}
      members={<Members members={members} me={KEY[viewer]} directory={DIRECTORY} roles={[{ pubkey: KEY.miky, role: 'Author' }]} readOnly={!!topic.archived} onSetMine={() => {}} onAdd={async () => false} />}
      actions={
        <div className="flex items-center gap-2">
          {!topic.archived && (
            // NEW HERE. Add to Open work, out of the menu and onto the page (Miky, 3 Nov: "more prominent and have keyboard shortcut").
            <WithTooltip label={inOpenWork ? 'Take out of Open work' : 'Add to Open work'} shortcut={openWorkKey()}>
              <Button
                size="small"
                variant="outlined"
                leadingIcon={inOpenWork ? <IconCheck size={14} stroke={1.5} /> : <IconLayoutDashboard size={14} stroke={1.5} />}
                aria-pressed={inOpenWork}
                onClick={onToggleOpenWork}
              >
                {inOpenWork ? 'In Open work' : 'Add to Open work'}
              </Button>
            </WithTooltip>
          )}
          <Toolbar aria-label="File actions" surface={false}>
            <SidePanelButton open={overview} onToggle={() => setOverview(!overview)} />
            {/* The topic's own menu: what you do to the topic itself (Miky, 3 Nov). */}
            <Menu
              align="right"
              trigger={
                <ToolbarButton tooltip="More actions" aria-label="More actions">
                  <IconDotsVertical size={16} stroke={1.5} />
                </ToolbarButton>
              }
            >
              {topic.archived ? (
                <>
                  <MenuItem label="Copy link" />
                  <MenuItem label="Unarchive" />
                  <MenuSeparator />
                  <MenuItem label="Delete" destructive />
                </>
              ) : (
                <>
                  <MenuItem label="Rename" />
                  <MenuItem label="Move…" />
                  <MenuItem label="Copy link" />
                  <MenuItem label="Archive…" />
                  <MenuSeparator />
                  <MenuItem label="Delete" destructive />
                </>
              )}
            </Menu>
          </Toolbar>
        </div>
      }
    />
  )

  const items: ConversationItem[] = messagesOf(topic.id).map((m) => ({
    id: m.id,
    day: m.day,
    card: <ConversationCard authorName={NAME[m.who]} authorBot={m.who === 'agent'} timestamp={m.time} body={m.body} readOnly={readOnly} messageId={m.id} />,
  }))

  const aside = overview ? (
    <OverviewPanel files={<TopicFiles key={topic.id} topic={topic} read={files} readOnly={readOnly} />} activity={<FileActivityPanelView items={[]} labelFor={new Map()} />} />
  ) : undefined

  return (
    <ConversationLayout
      threads="beside"
      title={topic.title}
      header={header}
      top={topic.archived ? <ArchivedNotice by="Miky" when={topic.atLabel} resolution="Shipped." onUnarchive={() => {}} /> : undefined}
      items={conversation === 'ok' ? items : []}
      loading={conversation === 'loading'}
      empty={<EmptyState scope="section" message={conversation === 'failed' ? 'The relay could not be reached.' : 'Nobody has commented yet.'} />}
      aside={aside}
      box={
        topic.archived ? (
          <ClosedBox reason="Archived. Unarchive it to comment." />
        ) : (
          <ConversationBox onSend={async () => ({ accepted: false, reason: { cause: 'unknown' } })} contextLabel={topic.title} />
        )
      }
    />
  )
}
