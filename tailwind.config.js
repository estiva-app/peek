import plugin from 'tailwindcss/plugin'

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Headings
        h1: ['26px', { lineHeight: '115%', letterSpacing: '-0.02em', fontWeight: '600' }],
        h2: ['22px', { lineHeight: '120%', letterSpacing: '-0.01em', fontWeight: '600' }],
        h3: ['18px', { lineHeight: '120%', letterSpacing: '0',        fontWeight: '600' }],
        h4: ['16px', { lineHeight: '150%', letterSpacing: '-0.01em', fontWeight: '600' }],
        h5: ['12px', { lineHeight: '100%', letterSpacing: '0',        fontWeight: '500' }],
        // Body
        'body-1': ['16px', { lineHeight: '150%', letterSpacing: '0', fontWeight: '400' }],
        'body-2': ['14px', { lineHeight: '140%', letterSpacing: '0', fontWeight: '400' }],
        'body-2-strong': ['14px', { lineHeight: '140%', letterSpacing: '0', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '120%', letterSpacing: '0', fontWeight: '400' }],
        menu:    ['9px',  { lineHeight: '115%', letterSpacing: '0', fontWeight: '500' }],
        // Component-specific
        'btn-default': ['14px', { lineHeight: '14px', letterSpacing: '0', fontWeight: '500' }],
        'btn-small':   ['12px', { lineHeight: '12px', letterSpacing: '0', fontWeight: '500' }],
        'input-label':  ['12px', { lineHeight: '115%', letterSpacing: '0', fontWeight: '500' }],
        'input-value':  ['14px', { lineHeight: '140%', letterSpacing: '0', fontWeight: '400' }],
        'input-helper': ['12px', { lineHeight: '120%', letterSpacing: '0', fontWeight: '400' }],
        'chip':         ['11px', { lineHeight: '110%', letterSpacing: '0', fontWeight: '500' }],
      },
      borderRadius: {
        none: '0px',
        sm:   '4px',
        md:   '6px',
        lg:   '8px',
        xl:   '12px',
        '2xl': '16px',
        '3xl': '24px',
        full: '9999px',
      },
      colors: {
        // bg
        'bg-base':      'var(--bg-base)',
        'bg-surface':   'var(--bg-surface)',
        'bg-elevated':  'var(--bg-elevated)',
        'bg-inset':     'var(--bg-inset)',
        'bg-hover':     'var(--bg-hover)',
        'bg-selected':  'var(--bg-selected)',
        'bg-active':    'var(--bg-active)',
        'bg-disabled':  'var(--bg-disabled)',
        'bg-private':   'var(--bg-private)',
        // text
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted':     'var(--text-muted)',
        'text-disabled':  'var(--text-disabled)',
        'text-inverse':   'var(--text-inverse)',
        // border
        'border-subtle':  'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong':  'var(--border-strong)',
        'border-focus':   'var(--border-focus)',
        'border-private': 'var(--border-private)',
        // accent (purple)
        'accent-primary': 'var(--accent-primary)',
        'accent-hover':   'var(--accent-hover)',
        'accent-muted':   'var(--accent-muted)',
        // brand wordmark (PeekLogo renders in currentColor)
        logo: 'var(--logo)',
        // semantic
        'info-default':    'var(--info-default)',
        'info-muted':      'var(--info-muted)',
        'warning-default': 'var(--warning-default)',
        'warning-muted':   'var(--warning-muted)',
        'success-default': 'var(--success-default)',
        'success-muted':   'var(--success-muted)',
        'error-default':   'var(--error-default)',
        'error-muted':     'var(--error-muted)',
      },
      boxShadow: {
        'sm':  'var(--shadow-sm)',
        'md':  'var(--shadow-md)',
        'lg':  'var(--shadow-lg)',
      },
      keyframes: {
        'skeleton-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
      },
      animation: {
        // Delayed reveal for loading skeletons: invisible for the first 150ms
        // so fast loads never flash a skeleton (user decision 2026-07-08).
        'skeleton-in': 'skeleton-in 0.2s ease-out 0.15s both',
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
