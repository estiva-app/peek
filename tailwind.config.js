import plugin from 'tailwindcss/plugin'
import estiva from '@estiva/ui/tailwind-preset'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  // The package's components are source; their classes must be scanned too.
  content: ['./index.html', './src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}', '../estiva-ui/src/**/*.{ts,tsx}'],
  /**
   * The shared tokens come from @estiva/ui (SHA-5, 2026-08-28): the type
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
  plugins: [
    // `signal:` variant — active only under the .signal theme class. Signal is
    // the app's only theme (2026-08-18), so these styles are what Peek looks
    // like; Storybook can also select dark and Estiva ID from its toolbar.
    plugin(({ addVariant }) => addVariant('signal', '.signal &')),
  ],
}
