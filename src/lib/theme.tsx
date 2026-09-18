import { createContext, useContext, useEffect } from 'react'

/**
 * Peek ships one theme: Signal.
 *
 * Light, dark and system were removed from the app (2026-08-18) — not because
 * the other palettes went away, but because offering them here made Signal one
 * option among four rather than what the product looks like. **The `:root`
 * (light) and `.dark` token blocks are deliberately kept in `index.css`**:
 * Storybook still renders both, and the Estiva ID theme is built on the light
 * palette. Nothing about the tokens was lost; only the picker was.
 */
export type Theme = 'signal'

/**
 * Signal is a dark-based theme.
 *
 * `.dark` stays on so every `dark:` variant still applies, and `.signal` layers
 * its palette and `signal:` variants on top. Dropping `.dark` here would
 * silently disable a large fraction of the styling.
 */
function applyThemeClasses() {
  document.documentElement.classList.add('dark', 'signal')
}

const ThemeContext = createContext<{ theme: Theme; resolved: Theme }>({
  theme: 'signal',
  resolved: 'signal',
})

const VALUE = { theme: 'signal', resolved: 'signal' } as const

/**
 * Puts Peek's one theme, Signal, on the page and tells the parts below it
 * which theme is on. In Storybook it leaves the toolbar's theme alone.
 * @registry reusable: Peek's own theme
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    /**
     * Storybook drives the theme from its toolbar, on the same element.
     *
     * Stories that mount the app shell wrap in this provider, so without the
     * guard the provider would stamp Signal over whatever the toolbar selected
     * and the dark and Estiva ID themes would be unreachable in exactly the
     * stories most worth looking at.
     */
    if (import.meta.env.STORYBOOK) return
    applyThemeClasses()
  }, [])

  return <ThemeContext.Provider value={VALUE}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
