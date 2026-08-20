import { IconUserFilled } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { useAvatarSrc } from '@/api'

// Signal-theme fallback palette: a stable per-person hue for gradient initials.
const SIGNAL_HUES = ['#56c8ff', '#ff8f6b', '#4ade8c', '#b18cff', '#ffc94d', '#ff7eb0', '#7ea8ff', '#5fdfd6']

const signalHueFor = (key: string) => {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return SIGNAL_HUES[Math.abs(h) % SIGNAL_HUES.length]
}

const initialsFor = (key: string) =>
  key
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

interface AvatarProps {
  src?: string
  /** When src is not provided, resolves the avatar by author name from PEOPLE. */
  name?: string
  alt?: string
  size?: number
  className?: string
}

export function Avatar({ src, name, alt = '', size = 36, className }: AvatarProps) {
  // Uploaded avatar > seeded demo portrait > silhouette. Outside a
  // PeekDataProvider (Storybook, tests) this falls back to the mock portraits.
  const avatarSrcFor = useAvatarSrc()
  const resolved = src ?? avatarSrcFor(name) ?? avatarSrcFor(alt)
  /*
   * Initials need somebody to take them from. Without a name the signal theme
   * used to draw `?` on a bright gradient, which reads as an error badge rather
   * than as a person — so an unnamed avatar is the silhouette in every theme
   * (found while rendering people with no published profile, FEE-1).
   */
  const label = name || alt
  return (
    <div
      className={cn('rounded-sm overflow-hidden shrink-0 bg-bg-inset', className)}
      style={{ width: size, height: size }}
    >
      {resolved ? (
        <img src={resolved} alt={alt || name || ''} className="w-full h-full object-cover" />
      ) : (
        <>
          {/* No portrait (e.g. a signed-up user before uploading one): a small
              FILLED person glyph on the accent-muted tint (user decision 2026-07-15). */}
          <div
            className={cn(
              'w-full h-full bg-accent-muted flex items-center justify-center text-text-muted',
              label && 'signal:hidden',
            )}
          >
            <IconUserFilled size={Math.round(size * 0.5)} />
          </div>
          {/* Signal theme replaces the glyph with gradient initials — when
              there is a name to make initials out of. */}
          {label && (
            <div
              className="w-full h-full hidden signal:flex items-center justify-center font-semibold"
              style={{
                color: '#08121c',
                fontSize: Math.round(size * 0.36),
                background: `linear-gradient(160deg, color-mix(in srgb, ${signalHueFor(label)} 92%, #fff) 0%, color-mix(in srgb, ${signalHueFor(label)} 70%, #0b0d11) 100%)`,
              }}
            >
              {initialsFor(label)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
