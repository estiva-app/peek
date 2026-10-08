import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppProvider } from '@estiva-app/ui'
import { useAvatarSrc } from '@/api'

/**
 * What only Peek knows, told to every estiva-ui part once: where a person's
 * picture is (their uploaded avatar, else the seeded portrait) and how Peek
 * changes page (its router).
 *
 * Peek used to wrap `Avatar`, `Person` and `NavItem` to do these one part at a
 * time; the package does them now, through its `AppProvider` (0.60.0;
 * Katerina, 8 October, UIG-49). Inside the router and the data stores, which
 * the lookup and `useNavigate` read.
 */
export function PeekSetup({ children }: { children: ReactNode }) {
  const pictureFor = useAvatarSrc()
  const navigate = useNavigate()
  return (
    <AppProvider pictureFor={pictureFor} navigate={navigate}>
      {children}
    </AppProvider>
  )
}
