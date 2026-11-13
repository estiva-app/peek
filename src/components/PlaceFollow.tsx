import { useState, type ReactNode } from 'react'
import { FollowSwitch, MembersPill, WhoFollowsDialog, type FollowChoice, type MembersDialogCandidate, type MembersDialogMember } from '@estiva-app/ui'
import type { People } from '@estiva-app/interop'
import type { FollowTarget, PlaceFollow } from '@/api'
import { useToast } from '@/lib/toast'

/** How many faces the pill draws; the count says the rest. */
const PILL_FACES = 3

export interface PlaceFollowControls {
  /** The switch, for the header's place before the title. Absent until the place is read, or when it could not be. */
  switcher: ReactNode
  /** Who follows it: faces and a count, opening the list. */
  pill: ReactNode
  /** The Who follows dialog, while open. */
  dialog: ReactNode
}

/**
 * The follow switch and Who follows for one place — a topic, a space or a
 * team's chat (TEA-6, from the approved prototype's FollowSwitch and
 * WhoFollowsDialog). Peek's part is which people, their names and faces, and
 * the writes. Add opens the standard add layer with its Invite button (Miky, 6
 * November); whoever is added joins at Important and can leave. A team's chat
 * has no Add: you come into it by joining the team, and its Who follows only
 * lists people (Miky, 6 November). In an archived team the switch cannot
 * change and nobody is added; the list still opens.
 *
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-place-lists-who-chose-a-level-and-its-teams-members.md
 */
export function usePlaceFollowControls({
  follow,
  target,
  title,
  teamName,
  me,
  directory,
  people,
  coming = false,
}: {
  /**
   * A switch will be drawn here (a topic in a team): its room is held while the teams and the place are read. Off for a
   * caller that draws something of its own meanwhile (a team chat's people icon).
   */
  coming?: boolean
  /** The place as read (`usePlaceFollow(target)`): the caller's, so a topic's view reads its level from the same read. */
  follow: PlaceFollow
  target: FollowTarget | undefined
  /** The place's name: the switch's accessible name and the dialog's title. */
  title: string
  /** The team whose default reaches the viewer here, for "Back to <team>’s default". */
  teamName?: string
  me: string | undefined
  /** The workspace's people: names, faces, and who Add offers. */
  directory: People | undefined
  /** Names and faces the file itself carries, for anyone the directory lacks. */
  people?: People
}): PlaceFollowControls {
  const { showToast } = useToast()
  const [open, setOpen] = useState<'list' | 'add' | null>(null)
  const archived = target?.archived ?? false
  // Read-only: an archived team holds nobody; an archived topic keeps who follows it, but changes nothing.
  const frozen = archived || (target?.fileArchived ?? false)
  const readOnlyReason = archived ? 'This team is archived' : frozen ? 'This topic is archived' : undefined
  const chat = target?.place.address.startsWith('39000:') ?? false

  const person = (pubkey: string) => directory?.[pubkey] ?? people?.[pubkey] ?? {}
  // The em dash for an unnameable person, as `Person` renders — never the key (FEE-1).
  const named = (pubkey: string) => (pubkey === me ? 'You' : (person(pubkey).displayName ?? '—'))
  const row = (pubkey: string): MembersDialogMember => ({ id: pubkey, name: named(pubkey), picture: person(pubkey).picture, bot: person(pubkey).bot === true })

  const listed = follow.listed ?? []
  const state = follow.state
  const level = state && state.shown !== 'not-following' ? state.shown : undefined

  const choose = async (choice: FollowChoice) => {
    const result = await follow.choose(choice === 'off' ? 'not-following' : choice)
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
  }
  const add = async (chosen: MembersDialogCandidate[]) => {
    const result = await follow.add(chosen.map((c) => c.id))
    if (!result.ok) showToast({ label: result.reason, type: 'error' })
    return result.ok
  }

  // While the place is read, or its target is still being worked out (`coming`: the teams are not read yet), its
  // switch's 24px is held empty: both can take seconds on a large workspace (about 20 on Miky's, 11 November), and the
  // title and the dot beside it (ACT-4) jumping right when it lands moved them out from under the pointer resting on
  // the dot, which closed its list. A failed read draws no switch, so nothing is held.
  const switcher =
    target && state ? (
      <FollowSwitch
        level={archived ? undefined : level}
        label={title}
        people={chat}
        // A team's chat lists no files: its levels say only what lights; a topic's or space's say what of its files it shows (ACT-5).
        files={!chat}
        onChoose={frozen ? undefined : choose}
        readOnlyReason={readOnlyReason}
        backTo={!frozen && state.againstDefault ? teamName : undefined}
      />
    ) : coming && !follow.failed ? (
      <span aria-hidden="true" className="size-6" data-follow-switch-pending />
    ) : undefined

  const pill =
    target && follow.listed ? (
      <MembersPill
        members={listed.slice(0, PILL_FACES).map((l) => ({ name: named(l.pubkey), picture: person(l.pubkey).picture, bot: person(l.pubkey).bot === true }))}
        count={listed.length}
        onClick={() => setOpen('list')}
      />
    ) : undefined

  // The viewer joins with the switch, never by adding themselves.
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
      initialView={open}
      onClose={() => setOpen(null)}
    />
  ) : undefined

  return { switcher, pill, dialog }
}
