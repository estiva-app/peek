import type { People } from '../../../convex/nostr/projection'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'

/**
 * A person named on another app's object (FEE-1).
 *
 * Peek used to show `a8a7d739…` here — the first eight characters of a
 * cryptographic key. That is not a person; it is the thing a person is behind.
 * Nobody recognises a colleague by it, and it looked like a bug rather than a
 * value, which is what the issue said.
 *
 * The name and face come off kind:0, resolved with the object rather than after
 * it, so the widget's own skeleton covers the wait and **a key is never on
 * screen** — not for a moment while a lookup lands, and not as a fallback.
 *
 * Deliberately not a link and not clickable. In the sidebar this sits inside a
 * control that reassigns the project, and one more thing to press there is the
 * last thing that row needs.
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
  const profile = people?.[pubkey]

  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {/*
       * `alt` doubles as Avatar's name lookup, which is what lets someone who
       * is also a Peek member show their Peek portrait when the relay holds no
       * picture for them. With neither, Avatar draws its silhouette — which is
       * the whole answer for an unknown person, so nothing else is needed here.
       */}
      <Avatar size={size} src={profile?.picture} alt={profile?.displayName ?? ''} />
      {/*
       * An em dash for someone nobody has published a name for, which is the
       * same mark this panel already uses for a property with no value. It says
       * "there is a person here and we cannot name them" without putting the
       * key back on screen to say it (Katerina, 2026-08-19).
       */}
      <span className="truncate">{profile?.displayName ?? '—'}</span>
    </span>
  )
}
