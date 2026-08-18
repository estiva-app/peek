import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { IconMenu2, IconHelpCircle, IconLogout, IconUser } from '@tabler/icons-react'
import { useSignOut } from '@/auth/useSignOut'
import { IconButton } from './ui/IconButton'
import { Avatar } from './ui/Avatar'
import { SearchInput } from './ui/SearchInput'
import { DebugMenu } from './DebugMenu'
import { ProfileDialog } from './ProfileDialog'
import { hasConvex, useCurrentUser, CURRENT_USER_NAME } from '@/api'

interface TopBarProps {
  onMenuToggle?: () => void
  /** Clicking the search field opens the command launcher instead of focusing the input. */
  onSearchClick?: () => void
}

export function TopBar({ onMenuToggle, onSearchClick }: TopBarProps) {
  const signOut = useSignOut()
  const me = useCurrentUser()
  const [menuOpen, setMenuOpen] = useState(false)
  const [debugOpen, setDebugOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const helpRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close theme menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (avatarRef.current?.contains(e.target as Node)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

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
          <div ref={helpRef}>
            <IconButton
              tooltip="Debug"
              tooltipPlacement="bottom"
              aria-label="Debug"
              onClick={() => setDebugOpen((v) => !v)}
            >
              <IconHelpCircle size={16} stroke={1.5} />
            </IconButton>
          </div>
        )}
        <button
          ref={avatarRef}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Account menu"
          className="rounded-full cursor-pointer focus:outline-none"
        >
          <Avatar size={36} name={CURRENT_USER_NAME} alt="Your avatar" />
        </button>
      </div>

      {/* Avatar menu: identity, profile, sign out */}
      {menuOpen && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 bg-bg-elevated border border-border-default rounded-lg shadow-lg p-1"
          style={{ top: rect.bottom + 6, right: window.innerWidth - rect.right }}
        >
          {/* Signed-in identity (Convex mode; mock mode has no session) */}
          {hasConvex && me && (
            <>
              <div className="flex flex-col gap-0.5 px-3 py-2 min-w-[160px]">
                <span className="text-[14px] font-medium leading-[1.4] text-text-primary">{me.name}</span>
                {me.email && <span className="text-[12px] leading-[1.2] text-text-secondary">{me.email}</span>}
              </div>
              <div
                className="flex items-center gap-3 h-9 px-3 rounded-lg cursor-pointer transition-colors hover:bg-bg-hover min-w-[160px]"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setMenuOpen(false)
                  setProfileOpen(true)
                }}
              >
                <IconUser size={16} stroke={1.5} className="text-text-secondary shrink-0" />
                <span className="flex-1 text-[14px] font-normal leading-[1.4] text-text-primary">Edit profile</span>
              </div>
              <div className="border-t border-border-subtle my-1" />
            </>
          )}
          {/* Sign out (Convex mode only) */}
          {hasConvex && (
            <>
              <div className="border-t border-border-subtle my-1" />
              <div
                className="flex items-center gap-3 h-9 px-3 rounded-lg cursor-pointer transition-colors hover:bg-bg-hover min-w-[160px]"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setMenuOpen(false)
                  void signOut()
                }}
              >
                <IconLogout size={16} stroke={1.5} className="text-text-secondary shrink-0" />
                <span className="flex-1 text-[14px] font-normal leading-[1.4] text-text-primary">Sign out</span>
              </div>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Debug menu */}
      {debugOpen && (
        <DebugMenu anchorEl={helpRef.current} onClose={() => setDebugOpen(false)} />
      )}

      {/* Profile */}
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
    </div>
  )
}
