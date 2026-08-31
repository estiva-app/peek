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

  const appIcon = (app: LauncherApp, size = 20) =>
    app.id === 'peek' ? <PeekLogoMark height={size} /> : <ShipLogoMark height={size} />

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
      icon: React.ReactNode,
      title: React.ReactNode,
      subtitle: string | undefined,
      onSelect: () => void,
      trailing?: React.ReactNode
    ): Row => ({
      key,
      onSelect,
      render: (isHl) => (
        <>
          {iconTile(icon)}
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
        rows.push(
          simpleRow(
            action.id,
            appIcon(scope),
            action.label,
            scope.label,
            () => enterForm(action)
          )
        )
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
      rows.push(
        simpleRow(
          a.id,
          appIcon(a),
          a.label,
          `${a.description} · ${a.actions.length} actions`,
          () => enterScope(a),
          <IconChevronRight size={16} stroke={1.5} className="text-text-secondary shrink-0" />
        )
      )
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
      // In the form, Escape is the keyboard's way BACK (Katerina 2026-08-31);
      // one more Escape from the list closes, same as everywhere else.
      if (formAction) popLevel()
      else onClose()
      return
    }
    /*
     * Form mode owns the rest of its keyboard: fields need Backspace, arrows
     * and Enter to mean what they mean in a form.
     */
    if (formAction) return
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
  // in the form (the row label without its trailing ellipsis).
  const chipLabel = formAction
    ? `${scope?.label} · ${formAction.label.replace(/\.\.\.$/, '')}`
    : scope?.label

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
                {appIcon(scope, 14)}
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
            <div className="flex items-center justify-center px-1 py-px rounded-sm bg-bg-inset border border-border-strong shrink-0 signal:bg-[rgba(255,255,255,0.05)] signal:border-border-default signal:border-b-2 signal:rounded">
              <span className="text-caption text-text-secondary whitespace-nowrap signal:font-mono signal:text-[10px]">esc</span>
            </div>
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
                    'flex items-center gap-3 h-12 px-3 cursor-pointer transition-colors rounded-lg',
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

          {/* Footer. In form mode it carries the shortcuts in every theme
              (the submit tip lives here, not beside the button); the list
              levels keep the signal-only navigation tips. */}
          {formAction ? (
            <div className="flex items-center gap-4 h-9 px-4 border-t border-border-subtle shrink-0 select-none text-caption text-text-secondary signal:font-mono signal:text-[10px] signal:text-text-muted">
              <span className="flex items-center gap-1.5">
                {keyBadge('⌘ ↩')} {formAction.submitLabel.toLowerCase()}
              </span>
              <span className="flex items-center gap-1.5">{keyBadge('esc')} back</span>
            </div>
          ) : (
            <div className="hidden signal:flex items-center gap-4 h-9 px-4 border-t border-border-subtle shrink-0 font-mono text-[10px] text-text-muted select-none">
              <span className="flex items-center gap-1.5">
                <kbd>↑</kbd>
                <kbd>↓</kbd> navigate
              </span>
              <span className="flex items-center gap-1.5">
                <kbd>enter</kbd> open
              </span>
              <span className="flex items-center gap-1.5">
                <kbd>esc</kbd> close
              </span>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
