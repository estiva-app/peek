import { useEffect } from 'react'

/**
 * The browser tab's title: the page first, then the app, so a narrow tab still
 * shows which page it is (SFX-2; Miky, 2026-10-30). Each page names itself; a
 * page that is loading or can't be read, or one that sets nothing, is just
 * "Peek" — never the previous page's title, which leaving a page clears.
 */
export function useTabTitle(page: string | undefined): void {
  useEffect(() => {
    document.title = page ? `${page} – Peek` : 'Peek'
    return () => {
      document.title = 'Peek'
    }
  }, [page])
}
