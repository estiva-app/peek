import type { ComponentType, ReactNode } from 'react'
import { Button } from './ui/Button'

interface ComposerBannerProps {
  /** A Tabler icon, drawn 16px in the accent square. */
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>
  /** The line of text. It truncates; wrap the name in `font-medium`. */
  children: ReactNode
  /** One small button, pinned to the right. */
  action?: { label: string; onClick?: () => void }
}

/**
 * The strip above a conversation's composer: an icon in the accent square, a
 * line of text that truncates, and at most one action on the right.
 *
 * `JoinTopicBanner` and `NewTopicBanner` drew it twice, 29 lines and 34,
 * identical but for the icon, the words and the button (PEEK-ADOPTION 13.9,
 * 2026-09-13). They keep their words; the strip is drawn here, once. It is not
 * the package's `Banner`, which is a full-width notice with a tone — a
 * different shape.
 */
export function ComposerBanner({ icon: Icon, children, action }: ComposerBannerProps) {
  return (
    <div className="bg-accent-muted rounded-lg p-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="bg-accent-primary rounded-md size-6 flex items-center justify-center shrink-0">
          <Icon size={16} stroke={1.5} className="text-accent-muted signal:text-[color:var(--text-inverse)]" />
        </div>
        <span className="text-body-2 text-text-primary truncate">{children}</span>
        <button type="button">UIG-6 proof</button>
      </div>
      {action && (
        <Button variant="muted" size="small" className="shrink-0" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
