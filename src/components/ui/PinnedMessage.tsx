import { Card } from '@estiva-app/ui'
import { Avatar } from './Avatar'
import { HighlightPill } from './HighlightPill'
import { previewText } from '@/lib/textParsing'
import type { HighlightType } from '@/api'

// ── Pinned Initial Message (compact) ──
//
// The original message shown pinned at the top of the thread panel: same author
// header as a full card, but the body is flattened to a single truncated line.

export interface PinnedMessageProps {
  authorName: string
  authorAvatarSrc?: string
  timestamp: string
  body: string
  highlightType?: HighlightType
}

/**
 * The first message of a conversation pinned at the top of the replies panel:
 * its author, time and one shortened line of text.
 */
export function PinnedMessage({ authorName, authorAvatarSrc, timestamp, body, highlightType }: PinnedMessageProps) {
  // Strip newlines AND formatting markers — previews are plain snippets.
  const flatBody = previewText(body).replace(/\n/g, ' ')

  return (
    // The package's Card, elevated and clipped: the box this drew by hand (UIG-14).
    <Card fill="elevated" clip>
      <div className="flex flex-col p-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Avatar size={24} src={authorAvatarSrc} alt={authorName} />
          <span className="text-body-2-strong text-text-primary min-w-0 truncate">{authorName}</span>
          <span className="text-caption text-text-muted shrink-0 whitespace-nowrap signal:font-mono signal:text-small signal:tracking-wide signal:tabular-nums">{timestamp}</span>
          {highlightType && <HighlightPill type={highlightType} />}
        </div>
        {/* Truncated body */}
        <div className="pl-8 pr-2 pt-1 pb-2">
          <p className="text-caption text-text-secondary truncate">
            {flatBody}
          </p>
        </div>
      </div>
    </Card>
  )
}
