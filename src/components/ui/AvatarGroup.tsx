import { AvatarGroup as UiAvatarGroup } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'

/**
 * Peek's member stack: the shared one from @estiva-app/ui (2026-09-01),
 * given the pictures Peek knows about — same lookup as Peek's Avatar
 * wrapper, uploaded avatar > seeded portrait > initials. Callers keep
 * passing bare names.
 */
export function AvatarGroup({ members }: { members: string[] }) {
  const avatarSrcFor = useAvatarSrc()
  return <UiAvatarGroup members={members.map((name) => ({ name, picture: avatarSrcFor(name) ?? undefined }))} />
}
