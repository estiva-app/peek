import { useState } from 'react'
import { Button, Card, SectionLabel } from '@estiva-app/ui'

/**
 * A deleted file's card under a message (ALO-6, SPEC §6.5): its title, then who deleted it and when, with Restore for
 * someone who may edit it — the story `Project changes`, Peek's card (approved 2 November). A deleted file is gone
 * from lists and search; a card to it still draws, so it never reads as live work.
 * why: https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-file-is-its-fields-each-kept-in-order-by-the-relay.md
 */
export function DeletedCard({
  title,
  noun,
  by,
  when,
  onRestore,
}: {
  title: string
  /** What it is, as the card's kind says it: "Project". */
  noun: string
  /** Who deleted it, in Peek's words: a name, or a dash for nobody named. */
  by: string
  /** When, with its day. */
  when: string
  /** Bring it back; absent for someone who may not edit it. Answers whether it went through. */
  onRestore?: () => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Card fill="inset" className="mt-1 p-3">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-body-2 font-semibold text-text-secondary">{title}</span>
        <SectionLabel className="shrink-0">{noun}</SectionLabel>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="min-w-0 flex-1 text-caption text-text-secondary">{`Deleted by ${by} · ${when}`}</span>
        {onRestore && (
          <Button
            variant="outlined"
            size="small"
            className="shrink-0"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onRestore().finally(() => setBusy(false))
            }}
          >
            Restore
          </Button>
        )}
      </div>
    </Card>
  )
}
