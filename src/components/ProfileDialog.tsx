import { IconExternalLink } from '@tabler/icons-react'
import { useCurrentUser, CURRENT_USER_NAME, PROFILE_EDIT_URL } from '@/api'
import { Avatar } from './ui/Avatar'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'

/**
 * Who Peek thinks you are — read-only (PEEK-42).
 *
 * This used to edit your name, role and avatar into Peek's own row. It no
 * longer edits anything: Estiva ID owns the profile, publishes it as `kind:0`,
 * and Peek reads it back off the relay. Two apps writing one profile is the
 * problem PEEK-31 solved for everyone else, and this dialog was the last place
 * still doing it.
 *
 * Kept rather than deleted because "what does Peek think my name is?" is a real
 * question — especially while a rename propagates — and the honest answer is a
 * view plus a link to the one place that can change it. Offering inputs that
 * write nowhere would be worse than offering nothing.
 */
export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const me = useCurrentUser()

  return (
    <DialogShell
      title="Profile"
      onClose={onClose}
      bodyClassName="flex flex-col gap-6"
      footer={
        <>
          <Button variant="muted" onClick={onClose}>Close</Button>
          {/* 16px, like every other icon on a default-size control in Peek —
              this one was 14 and read visibly smaller than the app around it
              (Katerina, 2026-08-20). 14 is the *small*-control size, which is
              what the small `Select`'s chevron and the small buttons use. */}
          <Button
            variant="primary"
            leadingIcon={<IconExternalLink size={16} stroke={1.5} />}
            onClick={() => window.open(PROFILE_EDIT_URL, '_blank', 'noopener,noreferrer')}
          >
            Edit in Estiva ID
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar size={64} src={me?.avatarUrl} name={CURRENT_USER_NAME} alt="Your avatar" />
        <div className="flex flex-col gap-1">
          <span className="text-body-1 text-text-primary">{me?.name ?? CURRENT_USER_NAME}</span>
          {me?.role && <span className="text-body-2 text-text-secondary">{me.role}</span>}
        </div>
      </div>

      {me?.email && (
        <div className="flex flex-col gap-2">
          <span className="text-input-label text-text-primary">Email</span>
          <span className="text-body-2 text-text-secondary">{me.email}</span>
        </div>
      )}

      <p className="text-input-helper text-text-muted">
        Your name, role and photo come from Estiva ID and are shared across every
        Estiva app. Changes can take a moment to reach Peek.
      </p>
    </DialogShell>
  )
}
