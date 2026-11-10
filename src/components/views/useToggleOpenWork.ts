import { useCallback } from 'react'
import { useOpenWorkFiles } from '@/api'
import { useToast } from '@/lib/toast'

/**
 * Add a file to Open work, or take it out, and say which (TOPI-7): the topic page's button, its Ctrl/Cmd+O and a
 * topic row's menu item all do it the same way, with Undo on the toast, as the approved story has it.
 */
export function useToggleOpenWork(): { has: (address: string) => boolean; toggle: (address: string) => void } {
  const openWorkFiles = useOpenWorkFiles()
  const { showToast } = useToast()
  const toggle = useCallback(
    (address: string) => {
      const had = openWorkFiles.has(address)
      const flip = (into: boolean) => (into ? openWorkFiles.add(address) : openWorkFiles.remove(address))
      flip(!had)
      showToast({
        label: had ? 'Taken out of Open work' : 'Added to Open work',
        type: had ? 'neutral' : 'success',
        actionLabel: 'Undo',
        onAction: () => flip(had),
      })
    },
    [openWorkFiles, showToast],
  )
  return { has: openWorkFiles.has, toggle }
}
