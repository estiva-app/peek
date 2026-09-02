import type { People } from '@estiva-app/interop'
import { Person as UiPerson } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'

/**
 * Peek's Person: the shared one from @estiva-app/ui, given the profile Peek
 * resolved (2026-09-01). The lookup — the relay's picture, else Peek's
 * portrait for that name — is the only thing that is Peek's, the same split
 * as Avatar's. A key is never on screen (FEE-1): the shared component takes
 * a name and a picture and cannot be handed anything else, and it draws the
 * em dash for someone nobody has published a name for.
 */
export function Person({
  pubkey,
  people,
  size = 16,
  className,
}: {
  pubkey: string
  /** From the resolved object. Absent in the states where nothing resolved. */
  people?: People
  size?: number
  className?: string
}) {
  const avatarSrcFor = useAvatarSrc()
  const profile = people?.[pubkey]
  const name = profile?.displayName
  return <UiPerson name={name} picture={profile?.picture ?? avatarSrcFor(name)} size={size} className={className} />
}
