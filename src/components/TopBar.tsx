import { useState, useRef } from 'react'
import { IconMenu2, IconHelpCircle } from '@tabler/icons-react'
import { useSignOut } from '@/auth/useSignOut'
import { IdentityMenu, MenuItem } from '@estiva-app/ui'
import { IconButton } from './ui/IconButton'
import { SearchInput } from './ui/SearchInput'
import { DebugMenu } from './DebugMenu'
import { hasConvex, useAvatarSrc, useCurrentUser, useRelayUrl, CURRENT_USER_NAME, PROFILE_EDIT_URL } from '@/api'

interface TopBarProps {
  onMenuToggle?: () => void
  /** Clicking the search field opens the command launcher instead of focusing the input. */
  onSearchClick?: () => void
}

export function TopBar({ onMenuToggle, onSearchClick }: TopBarProps) {
  const signOut = useSignOut()
  const me = useCurrentUser()
  const avatarSrcFor = useAvatarSrc()
  const relayUrl = useRelayUrl()
  /* The element the debug menu hangs off, captured when it is opened rather
     than read from a ref during render — the menu row that opens it unmounts
     as the account menu closes, so its own ref would be null by the time it
     is needed. The anchor is the top bar's right cluster, which persists. */
  const [debugAnchor, setDebugAnchor] = useState<HTMLElement | null>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  const displayName = me?.name ?? CURRENT_USER_NAME

  return (
    <div className="absolute top-0 left-0 right-0 h-[52px] flex items-center pl-5 pr-[26px] z-10 pointer-events-none">
      {/* Left */}
      <div className="pointer-events-auto">
        <IconButton tooltip="Toggle menu" tooltipPlacement="bottom" onClick={onMenuToggle} aria-label="Toggle menu">
          <IconMenu2 size={16} stroke={1.5} />
        </IconButton>
      </div>

      {/* Center */}
      <div className="flex-1 flex items-center justify-center pointer-events-auto">
        {/* The field is a launcher affordance, not a real input - clicking opens
            the command launcher; preventDefault keeps the input from focusing. */}
        <div
          className="cursor-pointer"
          onMouseDown={(e) => {
            e.preventDefault()
            onSearchClick?.()
          }}
        >
          <SearchInput shortcut="⌘ K" className="w-[290px] pointer-events-none" />
        </div>
      </div>

      {/* Right */}
      <div ref={rightRef} className="flex items-center gap-[6px] pointer-events-auto">
        {/* Debug menu is a dev affordance over the mock dataset — hidden on the
            real (Convex-backed) app (issue #6). */}
        {!hasConvex && (
          <div>
            <IconButton
              tooltip="Debug"
              tooltipPlacement="bottom"
              aria-label="Debug"
              // Swallowed so the shared shell's outside-mousedown dismiss
              // does not fire first and turn the toggle into close-reopen.
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(e) => setDebugAnchor((a) => (a ? null : e.currentTarget))}
            >
              <IconHelpCircle size={16} stroke={1.5} />
            </IconButton>
          </div>
        )}
        {/* The shared IdentityMenu (2026-09-01), Ship's anatomy, her ruling:
            identity section, workspace line naming the relay, and the actions
            — Edit your profile in Estiva ID (the ProfileDialog this used to
            open is gone; Estiva ID is the one place a profile changes),
            Sign out. Peek's shape survives as the compact face trigger; no
            Copy public key, because Peek has no viewer key to offer. */}
        <IdentityMenu
          compact
          me={{ name: displayName, picture: avatarSrcFor(displayName) ?? undefined, email: me?.email }}
          signedIn={hasConvex && me !== undefined}
          relayUrl={relayUrl}
          idBase={hasConvex ? PROFILE_EDIT_URL : undefined}
          onSignOut={hasConvex ? () => void signOut() : undefined}
        >
          {/* Read state (Convex mode). The dual-run readout lives in the debug
              menu, and the debug BUTTON is hidden here (issue #6) because its
              other sections drive the mock dataset — so on the real app the
              panel existed and nothing could open it. This is the way in — a
              click, so no mousedown is in flight when the debug shell arms
              its outside dismiss (see DebugMenu's header note). */}
          {hasConvex
            ? (close: () => void) => (
                <MenuItem
                  label="Read state"
                  onClick={() => {
                    const anchor = rightRef.current
                    close()
                    setDebugAnchor(anchor)
                  }}
                />
              )
            : undefined}
        </IdentityMenu>
      </div>

      {/* Debug menu */}
      {debugAnchor && (
        <DebugMenu anchorEl={debugAnchor} onClose={() => setDebugAnchor(null)} />
      )}
    </div>
  )
}
