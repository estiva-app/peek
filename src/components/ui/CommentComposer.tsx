import { useState } from 'react'
import { IconSend } from '@tabler/icons-react'
import { Form } from '@estiva-app/ui'
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
    // The package Form (UIG-7): Enter sends, and the row locks while it does.
    // The line above it is on a box of our own: a form draws nothing (UIG-9).
    <div className="border-t border-border-subtle">
      <Form busy={sending} onSubmit={send} className="flex items-center gap-2 px-3 py-2">
        <TextInput
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
        />
        <IconButton tooltip="Send" aria-label="Send comment" type="submit" disabled={!draft.trim() || sending}>
          <IconSend size={16} stroke={1.5} />
        </IconButton>
      </Form>
    </div>
  )
}
