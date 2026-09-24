import { useState, type ReactNode } from 'react'
import { shortcutLabel } from '@/lib/shortcuts'
import { IconMenu2 } from '@tabler/icons-react'
import { useSignOut } from '@/auth/useSignOut'
import { IdentityMenu, MenuItem } from '@estiva-app/ui'
import { ReadStatePanel } from './ReadStatePanel'
import { IconButton } from './ui/IconButton'
import { SearchInput } from './ui/SearchInput'
import { hasConvex, hasRelay, useAvatarSrc, useCurrentUser, useRelayUrl, CURRENT_USER_NAME, PROFILE_EDIT_URL } from '@/api'

export interface TopBarSlotsProps {
  onMenuToggle?: () => void
  /** Clicking the search field opens the command launcher instead of focusing the input. */
  onSearchClick?: () => void
}

/** What rides in the top bar's slots, and the Read state panel that hangs off it. */
export interface TopBarSlots {
  menu: ReactNode
  search: ReactNode
  identity: ReactNode
  /** Rendered beside the frame, not in it: a Popover that portals itself. */
  panel: ReactNode
}

/**
 * What rides in Peek's top bar — the menu button, the launcher affordance, the
 * identity — as slots, so the package's floating `AppShell` can draw the bar
 * (UIG-14, 9.3) and `TopBar` can still draw it on its own for its story and
 * test. Peek's, unchanged; only where it is drawn moved.
 */
export function useTopBarSlots({ onMenuToggle, onSearchClick }: TopBarSlotsProps): TopBarSlots {
  const signOut = useSignOut()
  const [cluster, setCluster] = useState<HTMLDivElement | null>(null)
  const [readStateOpen, setReadStateOpen] = useState(false)
  const me = useCurrentUser()
  const avatarSrcFor = useAvatarSrc()
  const relayUrl = useRelayUrl()
  /* The element the debug menu hangs off, captured when it is opened rather
     than read from a ref during render — the menu row that opens it unmounts
     as the account menu closes, so its own ref would be null by the time it
     is needed. The anchor is the top bar's right cluster, which persists. */

  const displayName = me?.name || CURRENT_USER_NAME
  const live = hasConvex || hasRelay

  return {
    menu: (
      <IconButton tooltip="Toggle menu" tooltipPlacement="bottom" onClick={onMenuToggle} aria-label="Toggle menu">
        <IconMenu2 size={16} stroke={1.5} />
      </IconButton>
    ),
    search: (
      /* The field is a launcher affordance, not a real input - clicking opens
         the command launcher; preventDefault keeps the input from focusing. */
      <div
        className="cursor-pointer"
        onMouseDown={(e) => {
          e.preventDefault()
          onSearchClick?.()
        }}
      >
        {/* @estiva-escape: a picture of the search field that opens the launcher; no part is a button that looks like a search field yet (UIG-9, Katerina 17 September) */}
        <SearchInput shortcut={shortcutLabel('Mod-K')} className="w-[290px] pointer-events-none" />
      </div>
    ),
    identity: (
      /*
        The cluster's element is the panel's anchor, captured by a callback
        ref into state rather than read during render: the row that opens
        the panel unmounts as the account menu closes, so its own ref would
        be null by the time it is wanted, and a ref read during render is
        what the hooks lint forbids by name.
      */
      <div ref={setCluster} className="flex items-center gap-[6px]">
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
          // No email line: the relay holds none, and Convex's copy is gone (REM-6).
          me={{ name: displayName, picture: avatarSrcFor(CURRENT_USER_NAME) ?? undefined }}
          // Signed in is Estiva ID's to say, and `AuthGate` renders none of
          // this without a session (REM-2); `me` is the relay's profile and may
          // still be loading. Mock mode has neither backend.
          signedIn={live}
          relayUrl={relayUrl}
          idBase={live ? PROFILE_EDIT_URL : undefined}
          onSignOut={live ? () => void signOut() : undefined}
        >
          {/*
            Read state, on the real app only — there is nothing to compare
            against without a backend. This row is the only way in: the
            debug button it used to share a panel with is gone (D48), and
            was hidden on the real app anyway.

            A click rather than a press, so no pointerdown is still in
            flight when the panel arms its own outside-dismiss.
          */}
          {hasConvex
            ? (close: () => void) => (
                <MenuItem
                  label="Read state"
                  onClick={() => {
                    close()
                    setReadStateOpen(true)
                  }}
                />
              )
            : undefined}
        </IdentityMenu>
      </div>
    ),
    /* Always there on the real app, opened by `open` — not mounted only while
       open (the package's Popover page; UIG-14). Only the real app has the
       row that opens it. */
    panel: hasConvex && <ReadStatePanel anchor={cluster} open={readStateOpen} onClose={() => setReadStateOpen(false)} />,
  }
}
