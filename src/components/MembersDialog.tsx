import { useState } from 'react'
import { DialogShell } from './ui/DialogShell'
import { IconArrowLeft, IconUserPlus } from '@tabler/icons-react'
import { IconButton } from './ui/IconButton'
import { Button } from './ui/Button'
import { Chip } from './ui/Chip'
import { PersonChipInput } from './ui/PersonChipInput'
import { Avatar } from './ui/Avatar'
import { usePeople, useCurrentUser, CURRENT_USER_NAME, type Person } from '@/api'

export type MembersDialogView = 'list' | 'add'

interface MembersDialogProps {
  /** Display names as shown in the members pill (the viewer may be 'You'). */
  memberNames?: string[]
  /** Viewer is a member — shows the "Add members" row and the add layer. */
  canAdd?: boolean
  /** 'list' from the members pill; 'add' jumps straight to the invite layer
   *  (the empty-topic banner). */
  initialView?: MembersDialogView
  onInvite: (invitees: Person[]) => void
  onClose: () => void
}

/**
 * The topic-members dialog (Slack's channel-members panel, scaled down).
 * Two layers in one dialog: the member roster with an "Add members" row on
 * top, and the invite layer (back arrow returns to the roster). Inviting
 * returns to the roster so the new members are immediately visible.
 *
 * On the shared DialogShell (2026-09-01): the roster layer is the footerless
 * shape (a list that simply ends), the invite layer the standard one, and
 * the back button and member-count chip ride in through `headerContent`.
 * Escape closes it now, which the hand-rolled shell never did.
 */
export function MembersDialog({
  memberNames = [],
  canAdd = false,
  initialView = 'list',
  onInvite,
  onClose,
}: MembersDialogProps) {
  const [view, setView] = useState<MembersDialogView>(initialView)
  const [invitees, setInvitees] = useState<Person[]>([])
  const people = usePeople() ?? []
  const me = useCurrentUser()
  const memberIds = people.filter((p) => memberNames.includes(p.name)).map((p) => p.id)
  const personByName = new Map(people.map((p) => [p.name, p]))
  /** Role as entered in the profile — both sources are reactive queries, so a
   *  profile edit updates the label live. The directory excludes the viewer,
   *  whose row renders as 'You' and reads from users.me instead. */
  const roleFor = (name: string): string | undefined => {
    const fromDirectory = personByName.get(name)?.role
    if (fromDirectory) return fromDirectory
    if (name === CURRENT_USER_NAME || name === me?.name) return me?.role || undefined
    return undefined
  }

  const canConfirm = invitees.length > 0
  const confirmInvite = () => {
    if (!canConfirm) return
    onInvite(invitees)
    setInvitees([])
    setView('list')
  }

  if (view === 'add') {
    return (
      <DialogShell
        title="Add members"
        onClose={onClose}
        headerContent={
          <div className="flex items-center gap-2 min-w-0">
            <IconButton
              tooltip="Back to members"
              aria-label="Back to members"
              className="-ml-2"
              onClick={() => setView('list')}
            >
              <IconArrowLeft size={16} stroke={1.5} />
            </IconButton>
            <span className="text-h4 text-text-primary truncate">Add members</span>
          </div>
        }
        bodyClassName="flex flex-col gap-6 overflow-y-auto"
        footer={
          <>
            <Button variant="muted" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canConfirm} onClick={confirmInvite}>
              Invite
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <label className="text-input-label text-text-primary flex items-center">
            Invite people
            <span className="text-error-default ml-0.5">*</span>
          </label>
          <PersonChipInput
            value={invitees}
            onChange={setInvitees}
            placeholder="Search people..."
            excludeIds={memberIds}
            autoFocus
          />
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell
      title="Members"
      onClose={onClose}
      headerContent={
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-h4 text-text-primary truncate">Members</span>
          <Chip label={String(memberNames.length)} />
        </div>
      }
      bodyClassName="p-0 py-2 max-h-[400px] overflow-y-auto"
    >
      {canAdd && (
        <div
          role="button"
          className="flex items-center gap-3 h-12 px-5 cursor-pointer hover:bg-bg-hover transition-colors"
          onClick={() => setView('add')}
        >
          <div className="size-8 rounded-md bg-accent-muted flex items-center justify-center shrink-0 text-accent-primary">
            <IconUserPlus size={16} stroke={1.5} />
          </div>
          <span className="text-[14px] font-medium leading-[1.4] text-text-primary">Add members</span>
        </div>
      )}
      {memberNames.map((name) => {
        const role = roleFor(name)
        return (
          <div key={name} className="flex items-center gap-3 h-12 px-5">
            <Avatar size={32} name={name} alt={name} />
            <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
              <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{name}</div>
              {role && (
                <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{role}</div>
              )}
            </div>
          </div>
        )
      })}
    </DialogShell>
  )
}
