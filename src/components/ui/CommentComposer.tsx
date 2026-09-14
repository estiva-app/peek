import { useState } from 'react'
import { IconSend } from '@tabler/icons-react'
import { TextInput } from '@/components/ui/TextInput'
import { IconButton } from '@/components/ui/IconButton'

/**
 * The smallest composer that is honest: one line, Enter sends, and the draft
 * dies with the conversation it was typed in (the caller keys this on the file
 * or the thread).
 *
 * Not Peek's message composer — that one is `kind:9`-shaped, with attachments
 * and drafts that survive navigation (CON-10), and the shared conversation
 * package (CON-5) is where the two become one. Until then this publishes
 * exactly what the owner's manifest declared a comment to be.
 *
 * Lifted out of `FoldersPage` by FOL-19, which needs it in two panes at once:
 * a comment on the file, and a reply inside a thread. It was already the only
 * thing in that page that had nothing to do with folders.
 */
export function CommentComposer({
  placeholder,
  onSend,
}: {
  placeholder: string
  /** Resolves `true` when the relay took it — the draft is cleared only then. */
  onSend: (body: string) => Promise<boolean>
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    const ok = await onSend(body)
    setSending(false)
    if (ok) setDraft('')
  }

  return (
    <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2">
      <TextInput
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // The one key handler here, and it is the package input's own submit
          // affordance rather than a shortcut invented for this app.
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void send()
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={sending}
      />
      <IconButton
        tooltip="Send"
        aria-label="Send comment"
        disabled={!draft.trim() || sending}
        onClick={() => void send()}
      >
        <IconSend size={16} stroke={1.5} />
      </IconButton>
    </div>
  )
}
