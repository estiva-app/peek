import estiva, { estivaContent } from '@estiva-app/ui/tailwind-preset'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // The package's components are source; their classes must be scanned too.
  // `estivaContent` is the package's own files. Tailwind does not merge
  // `content` from a preset — verified — so without spreading it every class
  // used only by a shared component is purged, and the app builds and tests
  // clean while rendering at the wrong size.
  content: [...estivaContent, './index.html', './src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'],
  /**
   * The shared tokens come from @estiva-app/ui (SHA-5, 2026-08-28): the type
   * ramp, radii, shadows, the skeleton animation and every colour name. What
   * stays here is Peek's alone — the huddle register and the wordmark — and
   * merges over the preset.
   */
  presets: [estiva],
  theme: {
    extend: {
      colors: {
        // private (huddle register) — distinct from accent, signals "private side-space"
        'bg-private':     'var(--bg-private)',
        'border-private': 'var(--border-private)',
        // brand wordmark (PeekLogo renders in currentColor)
        logo: 'var(--logo)',
      },
    },
  },
  // The `signal:` variant comes from the preset now (2026-08-28): Signal is a
  // theme in the package, and shared components carry their Signal touches.
  plugins: [],
}
