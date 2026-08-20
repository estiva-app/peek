import type { ReactNode } from 'react'

/**
 * A labelled property row — "Status", "Lead", and whatever else an app declares.
 *
 * Extracted from the Files panel so the topic details dialog can show a project
 * the same way the panel does (PEE-2). Two renderings of one thing is how they
 * drift, and these two sit a click apart.
 *
 * The 68px label column is what lines the values up into a column of their own;
 * `--text-secondary` rather than muted because a property label is content, not
 * a placeholder.
 */
export function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[68px] shrink-0 text-xs text-text-secondary">{label}</span>
      {children}
    </div>
  )
}
