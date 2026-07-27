import { useEffect, useState } from 'react'
import { useAction } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { ForeignObject, ResolvedSlot } from '../../../convex/nostr/projection'
import { hasConvex } from '@/api'
import { cn } from '@/lib/utils'

/**
 * Another app's object, rendered inline in Peek.
 *
 * The object is a Linear-lite issue; nothing in this file says so. The widget
 * type, which fields appear, their labels, the status vocabulary and its
 * colours all arrive from the owning app's NIP-89 manifest at runtime.
 *
 * What this file *does* own is how it looks. That split is the point: the owner
 * declares which fields matter, the consumer renders them in its own design
 * language, and a Linear ticket looks like Peek inside Peek. It is also why the
 * manifest declares a widget *type* rather than layout — an owner that could
 * specify arbitrary layout would control Peek's UI, which is the same reason
 * iframes are ruled out (RFC_UPDATES.md §3).
 */

/** Manifest colour names → Peek's own tokens. The mapping is Peek's business. */
const COLOUR: Record<string, string> = {
  neutral: 'bg-surface-raised text-text-secondary',
  blue: 'bg-info-subtle text-info-default',
  green: 'bg-success-subtle text-success-default',
  muted: 'bg-surface-raised text-text-tertiary',
}

function StatusPill({ slot }: { slot: ResolvedSlot }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        COLOUR[slot.colour ?? 'muted'] ?? COLOUR.muted,
      )}
    >
      {slot.value}
    </span>
  )
}

function Meta({ slot }: { slot: ResolvedSlot }) {
  // `as: "pubkey"` tells us to show a person rather than 64 hex characters.
  // Peek has profiles; until one is resolved, an abbreviation beats the raw key.
  const value = slot.isPubkey ? `${slot.value.slice(0, 8)}…` : slot.value
  return (
    <span className="text-xs text-text-tertiary">
      {slot.label ? `${slot.label}: ` : ''}
      {value}
    </span>
  )
}

export function ForeignObjectWidget({ naddr }: { naddr: string }) {
  const resolve = useAction(api.nostr.foreign.resolveObject)
  const [object, setObject] = useState<ForeignObject | null | 'loading'>('loading')

  useEffect(() => {
    // Peek runs without a deployment in tests, Storybook and checkouts with no
    // backend (`hasConvex`). There is no relay to ask in that mode, so resolve
    // to nothing rather than calling an action that has no client behind it.
    if (!hasConvex) {
      setObject(null)
      return
    }
    let cancelled = false
    // An action, not a query: this reads a relay over HTTP, which Convex's
    // reactive query layer cannot do. So there is no live update — the widget
    // reflects the moment it was resolved. Good enough for a message
    // attachment, and the honest limitation to note rather than hide.
    resolve({ naddr })
      .then((result) => !cancelled && setObject(result))
      .catch(() => !cancelled && setObject(null))
    return () => {
      cancelled = true
    }
  }, [naddr, resolve])

  // A reference we cannot resolve degrades to nothing, leaving the message text
  // intact. Never break a message because an attachment failed.
  if (object === 'loading' || object === null) return null

  if (object.unreachable) {
    return (
      <div className="mt-1 rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-xs text-text-tertiary">
        {object.appName ?? 'Another app'} object — you may not have access to this Folder.
      </div>
    )
  }

  const { slots, meta, comments, widget } = object

  return (
    <div
      data-foreign-object={object.address}
      className={cn(
        'mt-1 rounded-lg border border-border-subtle bg-surface-raised',
        widget === 'card' ? 'p-3' : 'px-3 py-2',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">
              {slots.title?.value}
            </span>
            {slots.status && <StatusPill slot={slots.status} />}
          </div>
          {/* A card shows the subtitle; a row is a single line by definition. */}
          {widget === 'card' && slots.subtitle && (
            <p className="mt-1 text-xs text-text-secondary">{slots.subtitle.value}</p>
          )}
          {meta.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {meta.map((slot, i) => (
                <Meta key={i} slot={slot} />
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-tertiary">
          {object.appName}
          {/* No recommendation existed, so the handler was a guess. Worth saying:
              "we were told" and "we guessed" should not look identical. */}
          {!object.viaRecommendation && ' ?'}
        </span>
      </div>

      {/* NIP-22 comments. The same events Linear-lite writes and reads — neither
          app owns the kind, which is what makes commenting work across both. */}
      {comments.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border-subtle pt-2">
          {comments.map((comment) => (
            <div key={comment.id} className="text-xs">
              <span className="text-text-tertiary">{comment.author.slice(0, 8)}… </span>
              <span className="text-text-secondary">{comment.body}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
