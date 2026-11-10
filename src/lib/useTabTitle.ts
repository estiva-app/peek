import { useEffect } from 'react'

/**
 * The browser tab's title: the page first, then the app, so a narrow tab still
 * shows which page it is (SFX-2; Miky, 2026-10-30). Each page names itself; a
 * page that is loading or can't be read, or one that sets nothing, is just
 * "Peek" — never the previous page's title, which leaving a page clears.
 */
/** A file's page name: its title, "Untitled" for none, nothing while it resolves or can't be read. */
export function fileTabTitle(file: { slots: { title?: { value?: string } } } | null): string | undefined {
  return file ? file.slots.title?.value || 'Untitled' : undefined
}

export function useTabTitle(page: string | undefined): void {
  useEffect(() => {
    document.title = page ? `${page} – Peek` : 'Peek'
    return () => {
      document.title = 'Peek'
    }
  }, [page])
}
