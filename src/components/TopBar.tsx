
import { shortcutLabel } from '@/lib/shortcuts'
import { IconMenu2 } from '@tabler/icons-react'
import { useSignOut } from '@/auth/useSignOut'
import { IdentityMenu, TopBar as TopBarShell } from '@estiva-app/ui'
import { IconButton } from './ui/IconButton'
import { SearchInput } from './ui/SearchInput'
import { hasConvex, useAvatarSrc, useCurrentUser, useRelayUrl, CURRENT_USER_NAME, PROFILE_EDIT_URL } from '@/api'

interface TopBarProps {
  onMenuToggle?: () => void
  /** Clicking the search field opens the command launcher instead of focusing the input. */
  onSearchClick?: () => void
}

/**
 * The bar is the shared floating TopBar (2026-09-02); what rides in its
 * slots — the launcher affordance, the debug button, the identity — is
 * Peek's, unchanged.
 */
export function TopBar({ onMenuToggle, onSearchClick }: TopBarProps) {
  const signOut = useSignOut()
  const me = useCurrentUser()
  const avatarSrcFor = useAvatarSrc()
  const relayUrl = useRelayUrl()
  /* The element the debug menu hangs off, captured when it is opened rather
     than read from a ref during render — the menu row that opens it unmounts
     as the account menu closes, so its own ref would be null by the time it
     is needed. The anchor is the top bar's right cluster, which persists. */


  const displayName = me?.name ?? CURRENT_USER_NAME

  return (
    <>
      <TopBarShell
        variant="floating"
        menu={
          <IconButton tooltip="Toggle menu" tooltipPlacement="bottom" onClick={onMenuToggle} aria-label="Toggle menu">
            <IconMenu2 size={16} stroke={1.5} />
          </IconButton>
        }
        search={
          /* The field is a launcher affordance, not a real input - clicking opens
             the command launcher; preventDefault keeps the input from focusing. */
          <div
            className="cursor-pointer"
            onMouseDown={(e) => {
              e.preventDefault()
              onSearchClick?.()
            }}
          >
            <SearchInput shortcut={shortcutLabel('Mod-K')} className="w-[290px] pointer-events-none" />
          </div>
        }
        right={
          <div className="flex items-center gap-[6px]">
            {/* The shared IdentityMenu (2026-09-01), Ship's anatomy, her ruling:
                identity section, workspace line naming the relay, and the actions
                — Edit your profile in Estiva ID (the ProfileDialog this used to
                open is gone; Estiva ID is the one place a profile changes),
                Sign out. Peek's shape survives as the compact face trigger; no
                Copy public key, because Peek has no viewer key to offer. */}
            <IdentityMenu
              compact
              // flex, so the wrapper hugs the face exactly: as a block it grows a
              // line-box under the inline button and the face slips a pixel or
              // two down the bar (the shot diff caught it, 7 stories × 1271px).
              className="flex"
              // The picture is looked up by CURRENT_USER_NAME, never the
              // display name: the registry's viewer branch — the only place
              // the uploaded avatar lives — is keyed by the literal "You"
              // (src/api/avatars.tsx). Looking up by me.name silently
              // degrades a signed-in face to initials (shipped 2026-09-02;
              // pinned by TopBar.avatar.test.tsx).
              me={{ name: displayName, picture: avatarSrcFor(CURRENT_USER_NAME) ?? undefined, email: me?.email }}
              signedIn={hasConvex && me !== undefined}
              relayUrl={relayUrl}
              idBase={hasConvex ? PROFILE_EDIT_URL : undefined}
              onSignOut={hasConvex ? () => void signOut() : undefined}
            />
          </div>
        }
      />
    </>
  )
}
