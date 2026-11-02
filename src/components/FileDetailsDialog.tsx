import { IconCopy } from '@tabler/icons-react'
import type { ForeignObject } from '@estiva-app/interop'
import { useWorkspaceDirectory, type RenameOutcome } from '@/api'
import { Button } from './ui/Button'
import { DialogShell } from './ui/DialogShell'
import { IconButton } from './ui/IconButton'
import { EditableText, Person } from '@estiva-app/ui'
import { SectionLabel } from './ui/SectionHeader'
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
  summary,
  onSummarize,
}: {
  file: Pick<ForeignObject, 'address' | 'slots' | 'people'>
  /** Absent when the manifest declares no rename. Resolves to `null` when it went through, or to what to say. */
  onRename?: (title: string) => Promise<RenameOutcome>
  onClose: () => void
  /**
   * Open straight into the rename field, holding the name — what the menu's
   * own Rename item does, so "Rename" and "Details → Rename" are one control
   * reached two ways.
   */
  initialEditing?: boolean
  /**
   * The summary as it is now, whole (the summarize action's `current`): the
   * card's `subtitle` slot is cut at 280, and saving from a cut copy would
   * lose the rest. Absent, the slot is read.
   */
  summary?: string
  /** Absent when the manifest declares no summary change: the text alone, and no section when there is none. */
  onSummarize?: (summary: string) => Promise<RenameOutcome>
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
      // The shell's footer is the row that sets its buttons at the right.
      footer={
        <Button variant="outlined" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Section label="Name">
        {/*
          The kit's click-to-edit with Save (C13): the name and Rename — absent,
          not disabled, when the manifest declares none — then the field with
          Save and Cancel, Enter saving and Escape abandoning only the edit.
          Only a refusal keeps it open, with the draft and the reason; a warning
          is said under the name once it saved.
        */}
        <EditableText
          manner="buttons"
          label="Name"
          value={title}
          placeholder="Untitled"
          editLabel="Rename"
          required
          readOnly={!onRename}
          defaultEditing={initialEditing}
          onCommit={async (name) => {
            if (!onRename) return false
            try {
              return (await onRename(name)) ?? true
            } catch (error) {
              // Nothing may leave this control stuck on "Saving…".
              return { kind: 'error', message: error instanceof Error ? error.message : 'That rename did not go through.' }
            }
          }}
        />
      </Section>

      <SummarySection summary={summary ?? file.slots.subtitle?.value ?? ''} onSummarize={onSummarize} />
      {author && (
        <Section label="Created by">
          <Person name={people?.[author]?.displayName} picture={people?.[author]?.picture} bot={people?.[author]?.bot === true} size={24} />
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

/**
 * Where a topic's summary is read and written (SPEC §6.12): its page shows
 * none (Miky, 15 Oct, deciding on the short-summary prototype). Drawn as the
 * prototype's `PeekDetails` with the kit's click-to-edit with Save (C13), as
 * the name is: the text and Edit, or "No summary yet." and "Add a summary",
 * then a field with Save and Cancel. Past about 240 a count appears and
 * nothing is refused. A refused save keeps the field open with your text and
 * the reason — why:
 * https://github.com/estiva-app/estiva-docs/blob/main/decisions/a-refused-action-is-undone-and-your-text-comes-back.md
 *
 * Saving an empty field clears the summary, the one the topic was started
 * with included.
 */
function SummarySection({ summary, onSummarize }: { summary: string; onSummarize?: (summary: string) => Promise<RenameOutcome> }) {
  // Someone who can't edit sees no section when there is nothing to read.
  if (!summary && !onSummarize) return null
  return (
    <Section label="Summary">
      <EditableText
        manner="buttons"
        multiline
        label="Summary"
        value={summary}
        placeholder="No summary yet."
        fieldPlaceholder="What is it for, in a sentence?"
        editLabel="Edit"
        addLabel="Add a summary"
        clean={summaryText}
        draftNote={(draft) => <SummaryCount text={draft} />}
        readOnly={!onSummarize}
        onCommit={async (text) => {
          if (!onSummarize) return false
          let outcome: RenameOutcome
          try {
            outcome = await onSummarize(text)
          } catch (error) {
            outcome = { kind: 'error', message: error instanceof Error ? error.message : 'The relay gave no reason.' }
          }
          // A refusal keeps the field open with your text, and says so in these words.
          return outcome?.kind === 'error' ? { kind: 'error', message: `Summary not saved. ${outcome.message} Your text is still here.` } : (outcome ?? true)
        }}
      />
    </Section>
  )
}
