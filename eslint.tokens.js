import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults'
import { parser as typescriptParser } from 'typescript-eslint'

/**
 * The token contract as a machine rule — the package's `eslint.config.js`
 * (estiva-ui, stage 0), already in Ship since #130 (ADOPTION S11, D36), now in
 * Peek (D55, ruled 2026-09-10).
 *
 * Three things a class list may not do, each of which has shipped a silent
 * defect in this suite:
 *
 * 1. Name a class Tailwind does not generate. The token names are doubled in
 *    the class (`bg-bg-surface`, not `bg-surface`); the shorter spelling
 *    compiles to nothing and is dropped without a word. Ship's sign-in screen
 *    rendered transparent that way (COMPONENTS-SHIP F1), and Peek's Folder
 *    panel drew an unfilled card on `bg-surface-raised` for months.
 *    `no-unknown-classes` reads `tailwind.config.js`, so it knows exactly what
 *    the preset generates.
 * 2. Reach for Tailwind's own type ramp or palette (`text-sm`, `bg-gray-100`).
 *    Those are not tokens, so they do not follow the theme — and Peek has four
 *    themes, Signal among them.
 * 3. Write a raw colour into an arbitrary value, or an opacity modifier on a
 *    token colour (`bg-bg-inset/40` compiles to nothing — F17, D16). A colour
 *    with no token is a missing token; it goes into the package's tokens.css.
 *
 * Where the plugin looks: every `className`, every `cn()` / `clsx()` argument,
 * and the values of a class map whose name ends in `Styles` / `_STYLES` or
 * `Classes` / `_CLASSES`. A class map named any other way is invisible to the
 * lint, so name it that way.
 *
 * This file is the rules alone, with no opinion about the rest of the set, so
 * that two callers can share it: `eslint.config.js`, where they sit beside
 * everything else Peek runs, and `eslint.tokens.config.js`, which runs them by
 * themselves as the CI gate. Peek's full lint carries a backlog of 79
 * pre-existing errors that this PR did not sign up to clear, so gating the
 * whole set would gate every deploy on it; gating these rules alone keeps the
 * contract enforced from the day it lands.
 */
/**
 * What the token contract does not reach.
 *
 * `demo-scenarios/` is a storyboard app with a tailwind config of its own,
 * written to be "independent of the app's config" — it does not load the
 * package's preset, so every class in it would read as unknown here and none of
 * it is Peek's UI. `convex/_generated` is generated. The rest is build output.
 */
export const TOKEN_LINT_IGNORES = ['dist', 'storybook-static', 'node_modules', 'demo-scenarios', 'convex/_generated']

export const tokenLint = {
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    parser: typescriptParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  plugins: { 'better-tailwindcss': betterTailwindcss },
  settings: {
    'better-tailwindcss': {
      tailwindConfig: 'tailwind.config.js',
      selectors: [
        ...getDefaultSelectors(),
        {
          kind: 'variable',
          name: '^(?:[A-Z][A-Z0-9_]*_(?:STYLES|CLASSES)|[a-z][a-zA-Z0-9]*(?:Styles|Classes))$',
          match: [{ type: 'strings' }, { type: 'objectValues' }],
        },
      ],
    },
  },
  rules: {
    'better-tailwindcss/no-unknown-classes': 'error',
    'better-tailwindcss/no-restricted-classes': [
      'error',
      {
        restrict: [
          {
            pattern: '^(?:[a-z0-9-]+:)*text-(?:xs|sm|base|lg|xl|[2-9]xl)$',
            message: "Tailwind's type ramp is not a token. Use the ramp from the package: text-body-2, text-caption, text-h3, text-btn-default...",
          },
          {
            pattern:
              '^(?:[a-z0-9-]+:)*(?:text|bg|border|ring|outline|fill|stroke|decoration|divide|placeholder|from|via|to|accent|caret|shadow)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?(?:/[0-9]{1,3})?$',
            message: "Tailwind's palette is not a token. Use a colour from the package (bg-bg-surface, text-text-primary, border-border-subtle...); a colour with no token is a missing token.",
          },
          {
            pattern: '^(?:[a-z0-9-]+:)*[a-z-]+-[[][^]]*(?:#[0-9a-fA-F]{3}|rgba?[(]|hsla?[(]|oklch[(])',
            message: 'A raw colour is a missing token: add it to the package (tokens.css in every theme block, and the preset), or say why not in an eslint-disable comment.',
          },
          {
            pattern: '^(?:[a-z0-9-]+:)*(?:text|bg|border|ring|outline|fill|stroke|decoration|divide|placeholder|from|via|to|accent|caret|shadow)-(?:bg|text|border|accent|info|warning|success|error)-[a-z-]+/[0-9]{1,3}$',
            message: 'An opacity modifier on a token colour compiles to nothing. A transparent colour is a token of its own (D16): add it to the package.',
          },
        ],
      },
    ],
  },
}
