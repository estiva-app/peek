import { useState, useRef } from 'react'
import { IconMenu2, IconHelpCircle, IconLogout, IconUser } from '@tabler/icons-react'
import { useSignOut } from '@/auth/useSignOut'
import { Menu, MenuItem, MenuRow, PersonTrigger } from '@estiva-app/ui'
import { Divider } from './ui/Divider'
import { IconButton } from './ui/IconButton'
import { SearchInput } from './ui/SearchInput'
import { DebugMenu } from './DebugMenu'
import { ProfileDialog } from './ProfileDialog'
import { hasConvex, useAvatarSrc, useCurrentUser, CURRENT_USER_NAME } from '@/api'

interface TopBarProps {
  onMenuToggle?: () => void
  /** Clicking the search field opens the command launcher instead of focusing the input. */
  onSearchClick?: () => void
}

export function TopBar({ onMenuToggle, onSearchClick }: TopBarProps) {
  const signOut = useSignOut()
  const me = useCurrentUser()
  const avatarSrcFor = useAvatarSrc()
  const [menuOpen, setMenuOpen] = useState(false)
  /* The element the debug menu hangs off, captured when it is opened rather
     than read from a ref during render — the menu item that opens it unmounts
     as the account menu closes, so its ref is null by the time it is needed. */
  const [debugAnchor, setDebugAnchor] = useState<HTMLElement | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const avatarRef = useRef<HTMLButtonElement>(null)

  // Position the menu below the avatar
  const rect = avatarRef.current?.getBoundingClientRect()

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
      <div className="flex items-center gap-[6px] pointer-events-auto">
        {/* Debug menu is a dev affordance over the mock dataset — hidden on the
            real (Convex-backed) app (issue #6). */}
        {!hasConvex && (
          <div>
            <IconButton
              tooltip="Debug"
              tooltipPlacement="bottom"
              aria-label="Debug"
              onClick={(e) => setDebugAnchor((a) => (a ? null : e.currentTarget))}
            >
              <IconHelpCircle size={16} stroke={1.5} />
            </IconButton>
          </div>
        )}
        {/* The shared PersonTrigger in its compact shape — the face alone, as
            this top bar has always drawn it (2026-09-01). Peek resolves the
            picture; the menu below stays Peek's. */}
        <PersonTrigger
          compact
          ref={avatarRef}
          size={36}
          name={CURRENT_USER_NAME}
          picture={avatarSrcFor(CURRENT_USER_NAME)}
          open={menuOpen}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Account menu"
        />
      </div>

      {/* Avatar menu: identity, profile, sign out — the shared shell owns the
          container and both exits now (Escape included, which this menu never
          had), and one Divider separates the groups where two hairlines used
          to stack. */}
      {menuOpen && rect && (
        <Menu onClose={() => setMenuOpen(false)} position={{ top: rect.bottom + 6, right: window.innerWidth - rect.right }}>
          {/* Signed-in identity (Convex mode; mock mode has no session) */}
          {hasConvex && me && (
            <>
              <MenuRow>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[14px] font-medium leading-[1.4] text-text-primary">{me.name}</span>
                  {me.email && <span className="truncate text-[12px] leading-[120%] text-text-secondary">{me.email}</span>}
                </span>
              </MenuRow>
              <MenuItem
                leading={<IconUser size={16} stroke={1.5} className="text-text-secondary" />}
                label="Edit profile"
                onClick={() => {
                  setMenuOpen(false)
                  setProfileOpen(true)
                }}
              />
            </>
          )}
          {/* Read state (Convex mode). The dual-run readout lives in the debug
              menu, and the debug BUTTON is hidden here (issue #6) because its
              other sections drive the mock dataset — so on the real app the
              panel existed and nothing could open it. This is the way in. */}
          {hasConvex && (
            <div
              className="flex items-center gap-3 h-9 px-3 rounded-lg cursor-pointer transition-colors hover:bg-bg-hover min-w-[160px]"
              onMouseDown={(e) => {
                e.preventDefault()
                const anchor = avatarRef.current
                setMenuOpen(false)
                setDebugAnchor(anchor)
              }}
            >
              <IconHelpCircle size={16} stroke={1.5} className="text-text-secondary shrink-0" />
              <span className="flex-1 text-[14px] font-normal leading-[1.4] text-text-primary">Read state</span>
            </div>
          )}
          {/* Sign out (Convex mode only) */}
          {hasConvex && (
            <>
              <Divider className="my-1" />
              <MenuItem
                leading={<IconLogout size={16} stroke={1.5} className="text-text-secondary" />}
                label="Sign out"
                onClick={() => {
                  setMenuOpen(false)
                  void signOut()
                }}
              />
            </>
          )}
        </Menu>
      )}

      {/* Debug menu */}
      {debugAnchor && (
        <DebugMenu anchorEl={debugAnchor} onClose={() => setDebugAnchor(null)} />
      )}

      {/* Profile */}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
    </div>
  )
}
