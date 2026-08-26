import { Avatar as UiAvatar, type AvatarProps as UiAvatarProps } from '@estiva/ui'
import { useAvatarSrc } from '@/api'

/**
 * Peek's Avatar: the shared one from @estiva/ui, given the picture Peek
 * knows about (SHA-5, 2026-08-28).
 *
 * The lookup is the only thing that is Peek's — uploaded avatar (Convex
 * file storage) > seeded demo portrait for that name > nothing, and then the
 * shared component draws initials on the person's colour, or the silhouette
 * when there is no name. Outside a PeekDataProvider (Storybook, tests) the
 * lookup falls back to the mock portraits, as before.
 */
export type AvatarProps = UiAvatarProps

export function Avatar({ src, name, alt = '', ...rest }: AvatarProps) {
  const avatarSrcFor = useAvatarSrc()
  const resolved = src ?? avatarSrcFor(name) ?? avatarSrcFor(alt)
  return <UiAvatar src={resolved} name={name} alt={alt} {...rest} />
}
