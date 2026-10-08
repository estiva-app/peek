import { useState } from 'react'
import { MembersDialog, MembersPill, type MembersDialogCandidate, type MembersDialogMember } from '@estiva-app/ui'
import type { People } from '@estiva-app/interop'
import type { Membership } from '@estiva-app/conversation'

/** How many faces the pill draws; the count says the rest. */
const PILL_FACES = 3

export interface MembersProps {
  /** The file's members by key (SPEC §11.8). `undefined` until the first read: nothing is drawn rather than a wrong count. */
  members: ReadonlyMap<string, Membership> | undefined
  /** The viewer's key. */
  me: string
  /** The workspace's people — names and faces, and who "Add members" offers. */
  directory: People | undefined
  /** Names and faces the file itself carries, for anyone the directory lacks. */
  people?: People
  /** Who holds a part in the file — "Author", and the owner's person fields ("Assignee", "Lead") — drawn as the row's second line, and listed "· not following" once they have left. */
  roles: { pubkey: string; role: string }[]
  /** One line under the roster. */
  note?: string
  /** No Join, Leave or Add: the file is read-only here (archived), or the viewer's membership is not known yet. */
  readOnly?: boolean
  /** Join (`true`) or leave (`false`). */
  onSetMine: (member: boolean) => void
  /** Add these people. Resolves `true` once the relay has taken every one. */
  onAdd: (pubkeys: string[]) => Promise<boolean>
}

/**
 * Who is in a file: the members pill for the file page's header, and the
 * Members dialog it opens, with Join or Leave for the viewer and "Add members"
 * (REA-3; Ship's `Members`, SHI-31, the old Peek design). Peek's part is which
 * people, what their second line says, and the writes — for any file, Ship's
 * or Peek's own, since the roles come off the owner's manifest.
 */
export function Members({ members, me, directory, people, roles, note, readOnly, onSetMine, onAdd }: MembersProps) {
  const [open, setOpen] = useState(false)
  if (!members) return null

  // The em dash for an unnameable person, as `Person` renders — never the key (FEE-1).
  const person = (pubkey: string) => directory?.[pubkey] ?? people?.[pubkey] ?? {}
  const named = (pubkey: string) => (pubkey === me ? 'You' : (person(pubkey).displayName ?? '—'))
  const rolesOf = (pubkey: string) => roles.filter((r) => r.pubkey === pubkey).map((r) => r.role)

  // You first, then by name; then whoever holds a part but has left, so a missed message has its reason on screen.
  const keys = [...members.keys()].sort((a, b) => Number(b === me) - Number(a === me) || named(a).localeCompare(named(b)))
  const left = [...new Set(roles.map((r) => r.pubkey))].filter((pubkey) => !members.has(pubkey)).sort((a, b) => named(a).localeCompare(named(b)))
  const rows: MembersDialogMember[] = [
    ...keys.map((pubkey) => ({ id: pubkey, name: named(pubkey), picture: person(pubkey).picture, caption: rolesOf(pubkey).join(' · ') || undefined })),
    // Their own id, so the picker (which leaves out rows by id) still offers them: anyone may add back somebody who left (Miky, 2026-10-07).
    ...left.map((pubkey) => ({ id: `left:${pubkey}`, name: named(pubkey), picture: person(pubkey).picture, caption: `${rolesOf(pubkey).join(' · ')} · not following` })),
  ]
  const candidates: MembersDialogCandidate[] = Object.entries(directory ?? {}).map(([pubkey, profile]) => ({
    id: pubkey,
    label: pubkey === me ? 'You' : (profile.displayName ?? '—'),
    picture: profile.picture,
  }))
  const isMember = members.has(me)

  return (
    <>
      <MembersPill
        members={keys.slice(0, PILL_FACES).map((pubkey) => ({ name: named(pubkey), picture: person(pubkey).picture }))}
        count={members.size}
        onClick={() => setOpen(true)}
      />
      {open && (
        <MembersDialog
          members={rows}
          count={members.size}
          self={readOnly ? undefined : { action: isMember ? 'leave' : 'join', onToggle: () => onSetMine(!isMember), id: me }}
          candidates={candidates}
          onAdd={!readOnly && isMember ? async (chosen) => onAdd(chosen.map((c) => c.id)) : undefined}
          note={note}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
