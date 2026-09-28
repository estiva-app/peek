import { useEffect, useState } from 'react'
import { IconCopy, IconPencil } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import type { RenameOutcome } from '@/api'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { IconButton } from './ui/IconButton'
import { Person } from './ui/Person'
import { SectionLabel } from './ui/SectionHeader'
import { TextInput } from './ui/TextInput'
import { FieldLine, Form } from '@estiva-app/ui'

/**
 * What a bare-file topic is, and where its name is changed (FOL-33).
 *
 * `TopicDetailsDialog`'s shape for a file rather than a channel: the name with
 * Rename beside it, then who started it and its address. No members and no
 * activity, because a file has neither — its people are its Folder's, and a
 * `30840` has no membership events to list. The address is here so it can be
 * pasted into another app, which is what makes a file a file rather than a
 * Peek topic: Ship lists it by exactly this string.
 *
 * Rename lives here for the two reasons the topic dialog gives — a refusal
 * needs somewhere to land, and a header title cannot be an input that refuses
 * to be typed in — with one difference. The topic dialog shows Rename only to
 * the creator, because the relay grants a channel's name change to its owner.
 * A file's rename is a change event its manifest declares, which anyone in the
 * team may publish, so Rename is offered whenever `onRename` is: the page
 * passes it when the manifest says so and not otherwise.
 */
export function FileDetailsDialog({
  file,
  onRename,
  onClose,
  initialEditing,
  initialError,
}: {
  file: Pick<ForeignObject, 'address' | 'slots' | 'people'>
  /** Absent when the manifest declares no rename. Resolves to `null` when it went through, or to what to say. */
  onRename?: (title: string) => Promise<RenameOutcome>
  onClose: () => void
  /**
   * Open straight into the rename field — what the menu's own Rename item
   * does, so "Rename" and "Details → Rename" are one control reached two ways.
   */
  initialEditing?: boolean
  /** The refusal to show on open. Stories and tests only. */
  initialError?: string
}) {
  const title = file.slots.title?.value ?? 'Untitled'
  // The author is the address's second segment (SPEC §6.1) — the one identity
  // a file carries that no change event can move.
  const author = file.address?.split(':')[1]
  const [editing, setEditing] = useState((initialEditing ?? false) && !!onRename)
  const [draft, setDraft] = useState('')
  const [outcome, setOutcome] = useState<RenameOutcome>(
    initialError ? { kind: 'error', message: initialError } : null,
  )
  const [saving, setSaving] = useState(false)

  // A rename that lands from elsewhere while this is open must not be
  // overwritten by a stale draft — `TopicDetailsDialogView`'s rule.
  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  const canonical = draft.trim()
  const changed = canonical !== '' && canonical !== title

  const save = async () => {
    if (!onRename || !changed) return
    setSaving(true)
    let result: RenameOutcome
    try {
      result = await onRename(canonical)
    } catch (error) {
      // Nothing may leave this control stuck on "Saving…".
      result = { kind: 'error', message: error instanceof Error ? error.message : 'That rename did not go through.' }
    } finally {
      setSaving(false)
    }
    setOutcome(result)
    // Only a real error keeps the field open; the draft is kept on one.
    if (result?.kind !== 'error') setEditing(false)
  }

  const copyAddress = () => {
    if (!file.address) return
    const address = file.address
    void navigator.clipboard?.writeText(address).catch(() => window.prompt('Copy this address:', address))
  }

  return (
    <DialogShell
      title="Topic details"
      onClose={onClose}
      width={560}
      bodyClassName="flex flex-col gap-6"
      footer={
        <div className="flex justify-end">
          <Button variant="outlined" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <Section label="Name">
        {editing ? (
          // The package Form (UIG-7): Enter saves, and the field locks while saving. `free`: a rename box and its buttons, not a list of fields.
          <Form busy={saving} onSubmit={save} layout="free" className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextInput
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Topic name"
                onKeyDown={(e) => {
                  // Escape abandons; Enter is the Form's, and saves.
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setEditing(false)
                    setOutcome(null)
                  }
                }}
              />
              <Button variant="primary" size="small" type="submit" disabled={!changed || saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  setEditing(false)
                  setOutcome(null)
                }}
              >
                Cancel
              </Button>
            </div>
            <Outcome outcome={outcome} />
          </Form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body-2 text-text-primary">{title}</span>
            {/* Absent, not disabled, when the manifest declares no rename. */}
            {onRename && (
              <Button
                variant="outlined"
                size="small"
                leadingIcon={<IconPencil size={14} stroke={1.5} />}
                onClick={() => setEditing(true)}
              >
                Rename
              </Button>
            )}
          </div>
        )}
        {!editing && <Outcome outcome={outcome} />}
      </Section>

      {author && (
        <Section label="Created by">
          <Person pubkey={author} people={file.people} size={24} />
        </Section>
      )}

      {file.address && (
        <Section label="Address">
          <div className="flex items-center gap-2">
            {/* The string another app lists this file by; mono so it reads as one. */}
            {/* @estiva-escape(no-copied-look): N9 (Katerina, 24 September: record only): a mono address, the text style Breadcrumb's id also uses, not a copy of a part */}
            <span className="min-w-0 flex-1 truncate font-mono text-caption text-text-secondary">{file.address}</span>
            <IconButton tooltip="Copy address" aria-label="Copy address" onClick={copyAddress}>
              <IconCopy size={16} stroke={1.5} />
            </IconButton>
          </div>
        </Section>
      )}
    </DialogShell>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  // 12px under the heading, as the topic dialog's sections (Katerina, 2026-08-20).
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </div>
  )
}

function Outcome({ outcome }: { outcome: RenameOutcome }) {
  if (!outcome) return null
  return <FieldLine tone={outcome.kind}>{outcome.message}</FieldLine>
}
