import { useEffect, useState } from 'react'
import { IconCopy, IconPencil, IconPlus } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import { useWorkspaceDirectory, type RenameOutcome } from '@/api'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { IconButton } from './ui/IconButton'
import { FieldLine, Form, Person } from '@estiva-app/ui'
import { SectionLabel } from './ui/SectionHeader'
import { TextInput } from './ui/TextInput'
import { Textarea } from './ui/Textarea'
import { SummaryCount } from './SummaryField'
import { summaryText } from '@/lib/summary'

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
  summary,
  onSummarize,
  initialSummaryError,
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
  /**
   * The summary as it is now, whole (the summarize action's `current`): the
   * card's `subtitle` slot is cut at 280, and saving from a cut copy would
   * lose the rest. Absent, the slot is read.
   */
  summary?: string
  /** Absent when the manifest declares no summary change: the text alone, and no section when there is none. */
  onSummarize?: (summary: string) => Promise<RenameOutcome>
  /** A refused summary to show on open, its field open. Stories and tests only. */
  initialSummaryError?: string
}) {
  const title = file.slots.title?.value ?? 'Untitled'
  // The author is the address's second segment (SPEC §6.1) — the one identity
  // a file carries that no change event can move.
  const author = file.address?.split(':')[1]
  /*
    The author's name, from everyone with a profile. The resolved file's own
    `people` holds only the keys its fields name (an assignee, a lead), and the
    author is in none of them, so "Created by" read it alone and drew the em
    dash for every file.
  */
  const directory = useWorkspaceDirectory()
  const people = author && file.people?.[author] ? file.people : directory
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
      title="Details"
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
                aria-label="Name"
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

      <SummarySection
        summary={summary ?? file.slots.subtitle?.value ?? ''}
        onSummarize={onSummarize}
        initialError={initialSummaryError}
      />
      {author && (
        <Section label="Created by">
          <Person name={people?.[author]?.displayName} picture={people?.[author]?.picture} size={24} />
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

/**
 * Where a topic's summary is read and written (SPEC §6.12): its page shows
 * none (Miky, 15 Oct, deciding on the short-summary prototype). Drawn as the
 * prototype's `PeekDetails` — the text and Edit, or "Add a summary", then a
 * field with Save and Cancel, the way Rename is. Past about 240 a count
 * appears and nothing is refused. A refused save keeps the field open with
 * your text and the reason — why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md
 *
 * Saving an empty field clears the summary, the one the topic was started
 * with included.
 */
function SummarySection({
  summary,
  onSummarize,
  initialError,
}: {
  summary: string
  onSummarize?: (summary: string) => Promise<RenameOutcome>
  initialError?: string
}) {
  const [editing, setEditing] = useState(!!initialError && !!onSummarize)
  const [draft, setDraft] = useState(initialError ? summary : '')
  const [outcome, setOutcome] = useState<RenameOutcome>(initialError ? { kind: 'error', message: initialError } : null)
  const [saving, setSaving] = useState(false)
  // A summary changed elsewhere while this is open replaces a draft nobody is typing.
  useEffect(() => {
    if (!editing) setDraft(summary)
  }, [summary, editing])

  // Someone who can't edit sees no section when there is nothing to read.
  if (!summary && !onSummarize) return null

  const canonical = summaryText(draft)
  // A refused text can be sent again as it is: the refusal may have been the relay's moment, not the text.
  const changed = canonical !== summaryText(summary) || outcome?.kind === 'error'
  const cancel = () => {
    setEditing(false)
    setOutcome(null)
  }
  const save = async () => {
    if (!onSummarize || !changed) return
    setSaving(true)
    let result: RenameOutcome
    try {
      result = await onSummarize(canonical)
    } catch (error) {
      result = { kind: 'error', message: error instanceof Error ? error.message : 'The relay gave no reason.' }
    } finally {
      setSaving(false)
    }
    setOutcome(result)
    if (result?.kind !== 'error') setEditing(false)
  }

  return (
    <Section label="Summary">
      {editing ? (
        <Form busy={saving} onSubmit={save} layout="free" className="flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={4}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              // Changing the refused text is a new attempt: the old reason goes.
              if (outcome?.kind === 'error') setOutcome(null)
            }}
            aria-label="Summary"
            placeholder="What is it for, in a sentence?"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                cancel()
              }
            }}
          />
          <SummaryCount text={draft} />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="small" type="submit" disabled={!changed || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outlined" size="small" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {outcome?.kind === 'error' ? (
            <FieldLine tone="error">Summary not saved. {outcome.message} Your text is still here.</FieldLine>
          ) : (
            <Outcome outcome={outcome} />
          )}
        </Form>
      ) : (
        <>
          <div className="flex items-start gap-2">
            {summary ? (
              <p className="min-w-0 flex-1 break-words text-body-2 text-text-primary">{summary}</p>
            ) : (
              <p className="min-w-0 flex-1 text-body-2 text-text-muted">No summary yet.</p>
            )}
            {onSummarize && (
              <Button
                variant="outlined"
                size="small"
                leadingIcon={summary ? <IconPencil size={14} stroke={1.5} /> : <IconPlus size={14} stroke={1.5} />}
                onClick={() => setEditing(true)}
              >
                {summary ? 'Edit' : 'Add a summary'}
              </Button>
            )}
          </div>
          <Outcome outcome={outcome} />
        </>
      )}
    </Section>
  )
}
