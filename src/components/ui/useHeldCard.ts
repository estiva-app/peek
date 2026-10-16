import { useCallback, useEffect, useState } from 'react'
import type { ForeignObject, People, ResolvedAction } from '@estiva-app/interop'
import { hasRelay, isFromCopy, useForeignObjects, useHeldObject, useWorkspaceDirectory } from '@/api'
import { noteCardAvailability } from '@/lib/unavailableCards'

/** How long a pick made on a card from the copy waits for the relay's answer before it is undone. */
const HELD_PICK_MS = 10_000

/** A picker's value in words, as its control draws it: the option's label, or the person's name. */
export function valueLabel(action: ResolvedAction, value: string, directory?: People, people?: People): string {
  if (action.control === 'pubkey') return value ? (directory?.[value]?.displayName ?? people?.[value]?.displayName ?? 'someone else') : 'Unassigned'
  return action.options?.find((option) => option.value === value)?.label ?? (value || 'none')
}

export interface HeldCard {
  /** The object, `'loading'` while asked, `null` for nothing. */
  object: ForeignObject | null | 'loading'
  /** `object` with a held pick drawn as if it were already the field's value. */
  drawn: ForeignObject | null | 'loading'
  /** The relay answered that there is nothing there; a failed read is not that. */
  gone: boolean
  busy: boolean
  error?: string
  onAct: (actionId: string, value: string, contentFormat?: string) => Promise<boolean>
  directory: People | undefined
}

/**
 * The file a card in a message stands for, and the changes a reader makes from
 * it: read from the tab's held answer (OPT-3), each change written through
 * `applyAction` and read back, since the relay is the authority on whether it
 * happened. `remember` keeps this device's answer of "not available", so the
 * next open draws that row from the first paint (OPT-10).
 */
export function useHeldCard(naddr: string, resolved?: ForeignObject, { remember = false }: { remember?: boolean } = {}): HeldCard {
  const { applyAction } = useForeignObjects()
  const directory = useWorkspaceDirectory()
  /*
    Already in hand — nothing to resolve (`resolved`), and a newer one from the
    page is taken, so an edit made elsewhere reaches the editor (MAN-9). Peek
    runs without a relay in tests, Storybook and checkouts with no
    `VITE_RELAY_URL` (`hasRelay`): nothing to ask, so it resolves to nothing.
    Otherwise the tab's held answer (OPT-3): a topic you come back to draws its
    widgets at once. The token matters here: without it this reads as the
    backend, a member of no channel, and every widget renders as broken.
  */
  const held = useHeldObject(resolved || !hasRelay ? null : naddr)
  const object: ForeignObject | null | 'loading' = resolved ?? (hasRelay ? held.object : null)
  // Returned, so an action's `await reload()` waits for the re-read it names.
  const reload = held.reload
  /*
    A chosen card's answer, remembered on this device: not available (nothing, or
    not readable), so the next open draws its one-line row at once; or available
    again. A failed read says neither.
  */
  const availability = object === 'loading' || (object === null && !held.gone) ? undefined : !!object && !object.unreachable
  useEffect(() => {
    if (remember && !resolved && availability !== undefined) noteCardAvailability(naddr, availability)
  }, [remember, resolved, availability, naddr])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  /*
    A pick made on a card drawn from the copy on the device: shown at once, sent
    only once the relay has answered and the field still holds what the card
    showed, and otherwise undone with a note (Miky, 2026-10-16, kickoff of "A
    Ship issue's card drawn from the copy has its controls at once"). The copy
    may be days old; a pick sent from it would quietly undo a newer change.
  */
  const [waiting, setWaiting] = useState<{ naddr: string; actionId: string; value: string; shown: string } | null>(null)
  const fromCopy = !!object && object !== 'loading' && isFromCopy(object)

  const onAct = useCallback(
    async (actionId: string, value: string, contentFormat?: string) => {
      if (fromCopy) {
        setError(undefined)
        setWaiting({ naddr, actionId, value, shown: object.actions.find((action) => action.id === actionId)?.current ?? '' })
        // Ask the relay now: a read that failed before the pick is retried rather than waited out.
        void reload()
        return true
      }
      setBusy(true)
      setError(undefined)
      try {
        const result = await applyAction({ naddr, actionId, value, ...(contentFormat ? { contentFormat } : {}) })
        // The relay is the authority on whether this happened, so re-read rather
        // than patching local state optimistically. Slower, and it means the
        // widget can never claim a change the shared record does not have.
        if (result.ok) await reload()
        else setError(result.reason)
        return result.ok
      } catch (e) {
        setError((e as Error).message)
        return false
      } finally {
        setBusy(false)
      }
    },
    [applyAction, naddr, reload, fromCopy, object],
  )

  // The relay's answer to a held pick: send it, drop it, or undo it with a note.
  useEffect(() => {
    if (!waiting || object === 'loading') return
    // The card now shows another file: its pick is not this one's to send.
    if (waiting.naddr !== naddr) return setWaiting(null)
    if (fromCopy) return
    setWaiting(null)
    // Gone, unreadable, or no longer offered — the workspace may have removed the app since the copy was kept.
    const now = object && !object.unreachable ? object.actions.find((action) => action.id === waiting.actionId) : undefined
    if (!now) {
      setError('Not sent: this can no longer be changed here.')
      return
    }
    const current = now.current ?? ''
    if (current === waiting.value) return
    if (current !== waiting.shown) {
      setError(`Not sent: changed meanwhile to ${valueLabel(now, current, directory, object?.people)}.`)
      return
    }
    void onAct(waiting.actionId, waiting.value)
  }, [waiting, object, fromCopy, naddr, onAct, directory])

  // A relay that does not answer at all — a failed read, or a card whose object only the page can replace — undoes the pick too.
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => {
      setWaiting(null)
      setError('Not sent: Peek could not reach the relay. Try again.')
    }, HELD_PICK_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  const drawn =
    waiting && object && object !== 'loading' && !object.unreachable
      ? { ...object, actions: object.actions.map((action) => (action.id === waiting.actionId ? { ...action, current: waiting.value } : action)) }
      : object

  return { object, drawn, gone: held.gone, busy: busy || !!waiting, error, onAct, directory }
}
