import { useState, type ReactNode } from 'react'
import { IconBell, IconBellOff, IconBellRinging } from '@tabler/icons-react'
import { Button, MembersPill, Menu, MenuItem, MenuSection, ToolbarButton, WhoFollowsDialog, type MembersDialogCandidate, type MembersDialogMember } from '@estiva-app/ui'
import type { SwitchChoice } from '@estiva-app/conversation'
import type { People } from '@estiva-app/interop'
import type { FollowTarget, PlaceFollow } from '@/api'
import { useToast } from '@/lib/toast'

/** How many faces the pill draws; the count says the rest. */
const PILL_FACES = 3

const ICON = { size: 16, stroke: 1.5 } as const

type BellLevel = 'all' | 'important' | 'not-following'

/**
 * The bell's three choices, in Katerina's words (16 November, PL-14, Q-34: "Everything", not "All"). A team's chat lists
 * no files, so its Everything says only "Every message", as today's switch words a chat apart from a topic.
 */
const LEVELS: { level: BellLevel; label: string; what: string; chat?: string; icon: ReactNode }[] = [
  { level: 'all', label: 'Everything', what: 'Every message, including on its files', chat: 'Every message', icon: <IconBellRinging {...ICON} aria-hidden /> },
  { level: 'important', label: 'Important', what: 'New conversations, replies to you, and mentions', icon: <IconBell {...ICON} aria-hidden /> },
  { level: 'not-following', label: 'Not following', what: 'You are only notified when someone names you.', icon: <IconBellOff {...ICON} aria-hidden /> },
]

export interface PlaceFollowControls {
  /** Whether the viewer is in the place: `undefined` until it is read, or when it could not be. */
  inIt: boolean | undefined
  /** The place could not be read: no bell and no Join, rather than a guess. */
  failed: boolean
  /** The bell, for the header's strip: only while you are in a place that can change (PL-12, PL-13, Q-38). */
  bell: ReactNode
  /** Join, the header's button with words, while you are not in a live topic (PL-09). None on a chat: its team is joined. */
  join: ReactNode
  /** Who follows it: faces and a count, opening the list. */
  pill: ReactNode
  /** The Who follows dialog, while open. */
  dialog: ReactNode
}

/**
 * How you follow one place — a topic, an initiative or a team's chat — as the navigation prototype draws it (Katerina,
 * 16 November, the decisions' step 5), over today's reads and writes (TEA-6, SPEC §11.8; the same choices as today's
 * switch, so Ship says and writes the same):
 *
 * - **Not in it:** Join, the header's button with words. It lands you at Important, and its toast says so (Q-39).
 * - **In it:** the bell, its own control, its icon the level — ringing Everything, plain Important. Its menu, "Notify me
 *   about", ticks the current one. Not following is Leave, as today (Q-40): the place leaves your list and Join comes
 *   back. It never changes what the page shows (PL-01, PL-12). No "Back to <team>'s default" (Q-35).
 * - **Who follows:** the pill, only people at Everything or Important (PL-08); your own row holds Leave, or Join (PL-10).
 *   Add opens the standard add layer; whoever is added joins at Important. A team's chat has no Add and no Join: you come
 *   into it by joining the team (Miky, 6 November).
 * - **Archived** (the team, or the topic itself): no bell, no Join, no Add and no Leave; the list still opens (Q-38).
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-place-lists-who-chose-a-level-and-its-teams-members.md
 */
export function usePlaceFollowControls({
  follow,
  target,
  title,
  me,
  directory,
  people,
}: {
  /** The place as read (`usePlaceFollow(target)`): the caller's, so a topic's view reads its level from the same read. */
  follow: PlaceFollow
  target: FollowTarget | undefined
  /** The place's name: the bell's and the dialog's. */
  title: string
  me: string | undefined
  /** The workspace's people: names, faces, and who Add offers. */
  directory: People | undefined
  /** Names and faces the file itself carries, for anyone the directory lacks. */
  people?: People
}): PlaceFollowControls {
  const { showToast } = useToast()
  const [open, setOpen] = useState<'list' | 'add' | null>(null)
  // Read-only: an archived team holds nobody; an archived topic keeps who follows it, but changes nothing.
  const frozen = (target?.archived ?? false) || (target?.fileArchived ?? false)
  const chat = target?.place.address.startsWith('39000:') ?? false

  const person = (pubkey: string) => directory?.[pubkey] ?? people?.[pubkey] ?? {}
  // The em dash for an unnameable person, as `Person` renders — never the key (FEE-1).
  const named = (pubkey: string) => (pubkey === me ? 'You' : (person(pubkey).displayName ?? '—'))
  const row = (pubkey: string): MembersDialogMember => ({ id: pubkey, name: named(pubkey), picture: person(pubkey).picture, bot: person(pubkey).bot === true })

  const listed = follow.listed ?? []
  const state = follow.state
  const shown: BellLevel | undefined = target && state ? state.shown : undefined
  const inIt = shown === undefined ? undefined : shown !== 'not-following'

  const choose = async (choice: SwitchChoice) => {
    const result = await follow.choose(choice)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    return result.ok
  }
  // Join lands you at Important (Katerina, 16 November, Q-39): the toast names it, with Undo.
  const join = async () => {
    if (await choose('important'))
      showToast({ label: `You joined ${title}. Notifications: Important.`, type: 'success', actionLabel: 'Undo', onAction: () => void choose('not-following') })
  }
  // Leave from your own row in Who follows: today's Not following, in today's words (Q-26).
  const leave = async () => {
    if (await choose('not-following')) showToast({ label: `Left “${title}”`, type: 'success' })
  }
  const add = async (chosen: MembersDialogCandidate[]) => {
    const result = await follow.add(chosen.map((c) => c.id))
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    return result.ok
  }

  const current = LEVELS.find((one) => one.level === shown)
  const bell =
    inIt && !frozen && current ? (
      <Menu
        align="right"
        trigger={
          <ToolbarButton tooltip={`Notifications: ${current.label}`} aria-label={`Notifications for ${title}: ${current.label}`}>
            {current.icon}
          </ToolbarButton>
        }
      >
        <MenuSection label="Notify me about">
          {LEVELS.map((one) => (
            <MenuItem
              key={one.level}
              label={one.label}
              description={chat && one.chat ? one.chat : one.what}
              leading={one.icon}
              selected={one.level === shown}
              onClick={() => {
                if (one.level !== shown) void choose(one.level)
              }}
            />
          ))}
        </MenuSection>
      </Menu>
    ) : undefined

  const joinButton =
    inIt === false && !frozen && !chat ? (
      <Button variant="primary" size="small" onClick={() => void join()}>
        Join
      </Button>
    ) : undefined

  const pill =
    target && follow.listed ? (
      <MembersPill
        members={listed.slice(0, PILL_FACES).map((l) => ({ name: named(l.pubkey), picture: person(l.pubkey).picture, bot: person(l.pubkey).bot === true }))}
        count={listed.length}
        onClick={() => setOpen('list')}
      />
    ) : undefined

  // Add offers everyone else; the viewer comes in with Join, never by adding themselves.
  const candidates: MembersDialogCandidate[] = Object.entries(directory ?? {})
    .filter(([pubkey]) => pubkey !== me)
    .map(([pubkey, profile]) => ({ id: pubkey, label: profile.displayName ?? '—', picture: profile.picture, bot: profile.bot === true }))

  const dialog = open ? (
    <WhoFollowsDialog
      title={title}
      all={listed.filter((l) => l.level === 'all').map((l) => row(l.pubkey))}
      important={listed.filter((l) => l.level === 'important').map((l) => row(l.pubkey))}
      candidates={candidates}
      onAdd={frozen || chat ? undefined : add}
      // Your own row: Leave, or Join when you are not in it (PL-10). None on a chat, nor anything archived.
      {...(me && inIt !== undefined && !frozen && !chat ? { self: { action: inIt ? ('leave' as const) : ('join' as const), id: me, onToggle: inIt ? leave : join } } : {})}
      initialView={open}
      onClose={() => setOpen(null)}
    />
  ) : undefined

  return { inIt, failed: follow.failed, bell, join: joinButton, pill, dialog }
}
