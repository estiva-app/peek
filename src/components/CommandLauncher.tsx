import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconSearch, IconChevronRight, IconX, IconPencil } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ActionFormPanel } from './ActionFormPanel'
import { PeekLogoMark } from './ui/PeekLogo'
import { ShipLogoMark } from './ui/ShipLogo'
import { useTopics } from '@/api'
import type { LauncherContext } from '@/lib/launcherContext'
import {
  LAUNCHER_APPS,
  type LauncherAction,
  type LauncherApp,
  type VocabOption,
} from '@/lib/launcherActions'

/** One selectable row: what it renders and what selecting it does. */
interface Row {
  key: string
  render: (isHighlighted: boolean) => React.ReactNode
  onSelect: () => void
  /** Single line of text, no tile: 36px instead of the 48px two-line row. */
  compact?: boolean
}

interface CommandLauncherProps {
  /** Captured at the invoking keystroke/click - see lib/launcherContext. */
  context: LauncherContext
  onClose: () => void
  /** Open pre-drilled into an app (stories only). */
  initialAppId?: string
  /** Open with an action's form already up (stories only; needs initialAppId). */
  initialActionId?: string
}

/**
 * The global command launcher (Cmd/Ctrl+K anywhere, or click the top-bar
 * search field) — the Intelligence modal's human face. Three levels, one
 * input:
 *  - global: search-default row + drillable app rows (Ship, Peek)
 *  - app scope: a chip in the input; the app's declared actions
 *  - form: an object-creating action drawn as a form (ActionFormPanel)
 * Backspace on an empty input pops one level. Esc always closes. Not a chat:
 * one input, one result set, no history.
 *
 * The apps and actions come from `lib/launcherActions.ts`, which mirrors the
 * NIP-89 manifest action shape — the Intelligence runtime will feed this
 * modal real manifests, and an agent will fill the same forms from context
 * instead of by hand (RFC 0.4 §13.4). Until that runtime lands, submitting a
 * form is inert: see `submitAction` below, which is the seam.
 *
 * The third-party mock apps that used to live here (Figma, Linear, GitHub,
 * Zendesk — and the Figma find mode) were removed 2026-08-31 with the design
 * decision to make the launcher list real Estiva apps only.
 */
export function CommandLauncher({
  context,
  onClose,
  initialAppId,
  initialActionId,
}: CommandLauncherProps) {
  const [scope, setScope] = useState<LauncherApp | null>(
    () => LAUNCHER_APPS.find((a) => a.id === initialAppId) ?? null,
  )
  const [formAction, setFormAction] = useState<LauncherAction | null>(() => {
    const app = LAUNCHER_APPS.find((a) => a.id === initialAppId)
    return app?.actions.find((a) => a.id === initialActionId) ?? null
  })
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [contextCleared, setContextCleared] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()

  // The effective context: the X on the context chip widens the launcher back
  // to the globally-capable action set without re-invoking it.
  const ctx: LauncherContext = contextCleared ? {} : context

  /*
   * Peek can list its own topics with no new machinery, so the `say` form's
   * parent picker is live even while everything else is v1 mock. Ship's
   * project list stays the registry's mock until the runtime can query
   * kind:30850 records.
   */
  const topics = useTopics()
  const liveParents = useMemo<Record<string, VocabOption[]>>(() => {
    const out: Record<string, VocabOption[]> = {}
    if (scope?.id === 'peek') {
      out.topic = (topics ?? [])
        .filter((t) => !t.isResolved)
        .map((t) => ({ value: t.id, label: t.title }))
    }
    return out
  }, [scope, topics])

  const enterScope = (app: LauncherApp) => {
    setScope(app)
    setFormAction(null)
    setQuery('')
  }
  const enterForm = (action: LauncherAction) => {
    setFormAction(action)
    setQuery('')
  }
  const popLevel = () => {
    if (formAction) setFormAction(null)
    else if (scope) setScope(null)
    setQuery('')
  }

  /**
   * THE SEAM. A validated form arrives here as `{ fieldKey: value }` plus the
   * manifest-shaped action that produced it. The Intelligence runtime turns
   * this into the event the declaration's `emits` describes, signs and
   * publishes it — and, invoked from a conversation, drops the new object's
   * `nostr:naddr…` reference into the active composer so the reply renders it
   * as a widget (`MessageBody` already does that half). Inert v1: close.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const submitAction = (action: LauncherAction, values: Record<string, string>) => {
    onClose()
  }

  const appIcon = (app: LauncherApp, size = 14) =>
    app.id === 'peek' ? <PeekLogoMark height={size} /> : <ShipLogoMark height={size} />

  /**
   * The app's tile: its mark, small, on a wash of its own brand colour —
   * minimal and discreet (Katerina 2026-08-31). Peek's is the accent-muted
   * badge the app already uses; Ship has no token here, so its wash and
   * letter come from `estiva-ui/tokens.css` `[data-theme='ship']`
   * (--accent-primary #4b58d4 / --accent-hover #5c69dc), stated inline
   * because Peek's palette deliberately does not carry another app's brand.
   */
  const appTile = (app: LauncherApp) => (
    <div
      className={cn(
        'flex items-center justify-center size-8 rounded-sm shrink-0',
        app.id === 'peek' ? 'bg-accent-muted' : 'bg-[rgba(75,88,212,0.14)]',
      )}
    >
      {app.id === 'peek' ? (
        <PeekLogoMark height={14} />
      ) : (
        <ShipLogoMark height={14} className="text-[#5c69dc]" />
      )}
    </div>
  )

  const enterHint = (
    <span className="text-caption text-text-secondary whitespace-nowrap shrink-0 signal:font-mono signal:text-[10px] signal:tracking-[0.04em]">↩ Enter</span>
  )

  /** The `esc` badge's styling, reused for every shortcut the footer names. */
  const keyBadge = (label: string) => (
    <span className="flex items-center justify-center px-1 py-px rounded-sm bg-bg-inset border border-border-strong signal:bg-[rgba(255,255,255,0.05)] signal:border-border-default signal:border-b-2 signal:rounded">
      <span className="text-caption text-text-secondary whitespace-nowrap signal:font-mono signal:text-[10px]">{label}</span>
    </span>
  )

  const iconTile = (content: React.ReactNode) => (
    <div className="flex items-center justify-center size-8 rounded-sm bg-bg-inset shrink-0">{content}</div>
  )

  const sectionHeader = (label: string) => (
    <div key={`hdr-${label}`} className="flex items-center h-7 px-3">
      <span className="text-[12px] font-medium leading-none text-text-secondary signal:font-mono signal:text-[10px] signal:uppercase signal:tracking-[0.14em]">{label}</span>
    </div>
  )

  // ── Assemble the rows for the current level ──

  const { rows, headers } = useMemo(() => {
    const rows: Row[] = []
    // headers[i] renders BEFORE row index i
    const headers = new Map<number, React.ReactNode>()

    const simpleRow = (
      key: string,
      icon: React.ReactNode | null,
      title: React.ReactNode,
      subtitle: string | undefined,
      onSelect: () => void,
      trailing?: React.ReactNode
    ): Row => ({
      key,
      onSelect,
      render: (isHl) => (
        <>
          {icon != null && iconTile(icon)}
          <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
            <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{title}</div>
            {subtitle && <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{subtitle}</div>}
          </div>
          {isHl ? enterHint : trailing}
        </>
      ),
    })

    // The form step renders ActionFormPanel instead of rows.
    if (formAction) return { rows, headers }

    if (scope) {
      const actions = q
        ? scope.actions.filter((a) => a.label.toLowerCase().includes(q))
        : scope.actions
      if (actions.length > 0) headers.set(0, sectionHeader(`${scope.label} actions`))
      for (const action of actions) {
        // No tile and no app name: the scope chip above already says both
        // (Katerina 2026-08-31 — they were redundant on every row).
        rows.push({ ...simpleRow(action.id, null, action.label, undefined, () => enterForm(action)), compact: true })
      }
      return { rows, headers }
    }

    // ── Global level ──
    if (q) {
      rows.push(
        simpleRow(
          'search',
          <IconSearch size={16} stroke={1.5} className="text-text-secondary" />,
          <>
            Search Peek for "<span className="font-medium">{query.trim()}</span>"
          </>,
          undefined,
          () => onClose() // inert v1
        )
      )
    }

    const apps = q
      ? LAUNCHER_APPS.filter((a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      : LAUNCHER_APPS
    if (apps.length > 0) headers.set(rows.length, sectionHeader('Apps'))
    for (const a of apps) {
      rows.push({
        key: a.id,
        onSelect: () => enterScope(a),
        render: (isHl) => (
          <>
            {appTile(a)}
            <div className="flex flex-col flex-1 min-w-0 gap-[2px] justify-center">
              <div className="text-[14px] font-normal leading-[1.4] text-text-primary truncate">{a.label}</div>
              <div className="text-[12px] leading-[1.2] text-text-secondary truncate">{`${a.description} · ${a.actions.length} actions`}</div>
            </div>
            {isHl ? enterHint : <IconChevronRight size={16} stroke={1.5} className="text-text-secondary shrink-0" />}
          </>
        ),
      })
    }
    return { rows, headers }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, query, scope, formAction, contextCleared])

  // Reset the highlight on every level/query change.
  const didInitHighlight = useRef(false)
  useEffect(() => {
    if (!didInitHighlight.current) {
      didInitHighlight.current = true
      return
    }
    setHighlight(0)
  }, [query, scope, formAction])

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-highlighted="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // A child that consumed the key keeps it: an open Select preventDefaults
    // its own Escape, and that press must close the menu, not pop the level.
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      // Escape ONLY closes; Backspace is the way back (Katerina 2026-08-31 —
      // two meanings on one key was a duplicate command).
      onClose()
      return
    }
    if (formAction) {
      /*
       * The form owns its keyboard, with one exception: Backspace with
       * nothing to delete steps back to the action list — the same gesture
       * the list levels use. A field that consumed it (text being edited,
       * a chip being removed) preventDefaults and never reaches here.
       */
      if (e.key === 'Backspace') {
        const t = e.target as HTMLElement
        const editable = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        if (!editable || (t as HTMLInputElement | HTMLTextAreaElement).value === '') {
          e.preventDefault()
          popLevel()
        }
      }
      return
    }
    if (e.key === 'Backspace' && query === '' && scope) {
      e.preventDefault()
      popLevel()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, rows.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
      return
    }
    // Tab or ArrowRight on an app row scopes into it (drill-in)
    if ((e.key === 'Tab' || e.key === 'ArrowRight') && !scope) {
      const row = rows[highlight]
      const app = LAUNCHER_APPS.find((a) => a.id === row?.key)
      if (app) {
        e.preventDefault()
        enterScope(app)
        return
      }
      if (e.key === 'Tab') e.preventDefault()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      rows[highlight]?.onSelect()
    }
  }

  const placeholder = scope ? scope.placeholder : 'Search Peek or choose an action...'

  // The chip names the level: "Ship" while listing, "Ship · Create issue"
  // in the form.
  const chipLabel = formAction ? `${scope?.label} · ${formAction.label}` : scope?.label

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />

      {/* Launcher - anchored high like a launcher, not centered like a dialog */}
      <div className="fixed inset-x-0 top-[18%] z-50 flex justify-center pointer-events-none">
        <div
          className="w-[658px] bg-bg-elevated border border-border-default rounded-lg shadow-lg pointer-events-auto flex flex-col overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Input row */}
          <div className="flex items-center gap-3 h-12 px-4 border-b border-border-subtle shrink-0">
            <IconSearch size={16} stroke={1.5} className="text-text-secondary shrink-0" />

            {/* Scope chip - the state made visible. Click the X (or Backspace on
                an empty input) to pop one level back out. */}
            {scope && (
              <div className="inline-flex items-center gap-1.5 bg-bg-inset border border-border-default rounded-full pl-2 pr-1 py-0.5 max-h-[24px] shrink-0">
                {appIcon(scope, 10)}
                <span className="text-[12px] leading-[1.2] font-medium text-text-primary whitespace-nowrap">
                  {chipLabel}
                </span>
                <button
                  type="button"
                  onClick={popLevel}
                  className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary"
                  aria-label={formAction ? `Leave ${formAction.label}` : `Leave ${scope.label}`}
                >
                  <IconX size={10} stroke={1.5} />
                </button>
              </div>
            )}

            {/* Context chip - what the launcher is acting on (the composer
                target an insert would land in). X widens back to the
                globally-capable set. Kept in form mode on purpose: it is where
                the created object's reference will land (see submitAction). */}
            {!contextCleared && ctx.composer && (
              <div className="inline-flex items-center gap-1.5 bg-bg-inset border border-border-default rounded-full pl-1.5 pr-1 py-0.5 max-h-[24px] max-w-[220px] shrink-0">
                <IconPencil size={12} stroke={1.5} className="text-text-secondary shrink-0" />
                <span className="text-[12px] leading-[1.2] font-medium text-text-primary truncate">
                  {ctx.composer?.label ?? 'Compose box'}
                </span>
                <button
                  type="button"
                  onClick={() => setContextCleared(true)}
                  className="size-4 flex items-center justify-center rounded-full hover:bg-bg-hover text-text-secondary shrink-0"
                  aria-label="Clear context"
                >
                  <IconX size={10} stroke={1.5} />
                </button>
              </div>
            )}

            {/* A form is not searched: the input yields to the chips there. */}
            {formAction ? (
              <div className="flex-1" />
            ) : (
              <input
                ref={inputRef}
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent text-input-value text-text-primary placeholder:text-text-muted outline-none"
              />
            )}
          </div>

          {/* Body: the action's form in form mode, rows otherwise */}
          {formAction && scope ? (
            <ActionFormPanel
              app={scope}
              action={formAction}
              parentOptions={liveParents}
              onSubmit={(values) => submitAction(formAction, values)}
            />
          ) : (
          <div ref={listRef} className="max-h-[400px] overflow-y-auto p-1">
            {rows.map((row, i) => (
              <div key={row.key}>
                {headers.get(i)}
                <div
                  data-highlighted={highlight === i}
                  className={cn(
                    'flex items-center gap-3 px-3 cursor-pointer transition-colors rounded-lg',
                    row.compact ? 'h-9' : 'h-12',
                    highlight === i && 'bg-bg-hover'
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    row.onSelect()
                  }}
                >
                  {row.render(highlight === i)}
                </div>
              </div>
            ))}
            {rows.length === 0 && headers.get(0)}
            {rows.length === 0 && !headers.get(0) && (
              <div className="flex items-center h-12 px-3">
                <span className="text-[14px] text-text-secondary">Nothing for that here.</span>
              </div>
            )}
          </div>
          )}

          {/* The footer carries the shortcuts in every theme — the input row
              stopped duplicating esc (Katerina 2026-08-31). */}
          <div className="flex items-center gap-4 h-9 px-4 border-t border-border-subtle shrink-0 select-none text-caption text-text-secondary signal:font-mono signal:text-[10px] signal:text-text-muted">
            {formAction ? (
              <>
                <span className="flex items-center gap-1.5">
                  {keyBadge('⌘ ↩')} {formAction.submitLabel.toLowerCase()}
                </span>
                <span className="flex items-center gap-1.5">{keyBadge('⌫')} back</span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  {keyBadge('↑')}
                  {keyBadge('↓')} navigate
                </span>
                <span className="flex items-center gap-1.5">{keyBadge('↩')} open</span>
              </>
            )}
            <span className="flex items-center gap-1.5">{keyBadge('esc')} close</span>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
