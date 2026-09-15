import betterTailwindcss from 'eslint-plugin-better-tailwindcss'
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults'
import { createRequire } from 'node:module'
import { parser as typescriptParser } from 'typescript-eslint'

// Tailwind's own loader: the preset imports `tailwindcss/plugin`, which a plain
// `import` cannot resolve.
const require = createRequire(import.meta.url)
const preset = require('tailwindcss/loadConfig')(require.resolve('@estiva-app/ui/tailwind-preset'))

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
            // `[^]]*` read as "any one character, then `]`", so this matched
            // nothing (UIG-28 R1); the package's pattern, which works.
            pattern: '^(?:[a-z0-9-]+:)*[a-z-]+-\\[[^\\]]*(?:#[0-9a-fA-F]{3}|rgba?\\(|hsla?\\(|oklch\\()',
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

/**
 * UIG-28: the values the tokens already name, written by hand (Katerina's
 * rulings B11, B12, C3 of 13 September and R2 of 15 September). The same block
 * as the package's `eslint.config.js`; both configs add it after `tokenLint`,
 * whose parser and plugin settings it borrows.
 *
 * `tokenLint` stops `text-sm` and `bg-[#fff]`. Until this, `text-[14px]` and
 * `style={{ color }}` walked straight past it.
 *
 * - Errors: type (`text-[14px]`, `leading-[1.4]`, `tracking-[0.08em]`),
 *   corners (`rounded-[3px]`) and shadows (`shadow-[…]`), and an inline
 *   `style` that sets a colour, a font size, a border or a shadow.
 * - Warnings, reported and never blocking: heights and spacing (`h-[240px]`,
 *   `gap-[3px]`) and border or ring widths (`ring-[1.5px]`). The preset has no
 *   spacing token; those steps are Tailwind's own scale.
 *
 * They sit under their own rule names, `token-values` and `token-spacing`
 * (the same plugin registered twice, so one runs as errors and one as
 * warnings), for two reasons: `tokenLint` stays as it was, and an escape for a
 * hand-written size cannot also silence a raw colour on the same line.
 *
 * The variant part of every pattern reads arbitrary variants too
 * (`[&_pre]:`, `data-[state]:`, `group-hover/row:`). A colour inside
 * `text-[…]` is left to the raw-colour rule above.
 *
 * Tests are out (ruling of 13 September): a test mounts markup to test it.
 *
 * A place that keeps a hand-written value says why (Katerina, 15 September):
 * `// eslint-disable-next-line <rule> -- @estiva-escape: <reason>`.
 */
const V = '^(?:(?:[^:\\[\\]\\s]|\\[[^\\]]*\\])+:)*!?'
const NOT_COLOUR = '(?!color:|#|rgba?\\(|hsla?\\(|oklch\\(|var\\()'
const HAND_WRITTEN = {
  type: `${V}(?:text-\\[${NOT_COLOUR}|text-\\[length:|leading-\\[|tracking-\\[)[^\\]]+\\](?:/\\S*)?$`,
  corner: `${V}rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-\\[[^\\]]+\\]$`,
  shadow: `${V}(?:shadow|drop-shadow)-\\[(?!color:)[^\\]]+\\]$`,
  spacing: `${V}-?(?:w|h|size|min-w|min-h|max-w|max-h|p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|translate-[xy]|basis|indent|scroll-[mp][xytrblse]?|border-spacing(?:-[xy])?)-\\[[^\\]]+\\]$`,
  width: `${V}(?:border(?:-[xytrblse])?|divide-[xy]|outline|ring|ring-offset)-\\[(?:length:)?-?[0-9.]+(?:px|rem|em)?\\]$`,
}

// `text-[14px]` names the token of that size, read from the preset, so the
// message stays true when the ramp changes.
const tokensBySize = {}
for (const [name, value] of Object.entries(preset.theme.extend.fontSize)) {
  const size = Array.isArray(value) ? value[0] : value
  ;(tokensBySize[size] ??= []).push(`text-${name}`)
}
const cornersBySize = {}
for (const [name, size] of Object.entries(preset.theme.extend.borderRadius)) (cornersBySize[size] ??= []).push(name === 'DEFAULT' ? 'rounded' : `rounded-${name}`)

const INLINE_STYLE_TOKEN_PROPERTIES =
  '/^(color|background|backgroundColor|backgroundImage|fill|stroke|fontSize|border|borderTop|borderRight|borderBottom|borderLeft|borderBlock|borderInline|borderStyle|boxShadow|textShadow)$|Color$/'

export const tokenValues = {
  files: ['**/*.{ts,tsx}'],
  ignores: ['**/*.test.ts', '**/*.test.tsx'],
  plugins: { 'token-values': betterTailwindcss, 'token-spacing': betterTailwindcss },
  rules: {
    'token-values/no-restricted-classes': [
      'error',
      {
        restrict: [
          ...Object.entries(tokensBySize).map(([size, names]) => ({
            pattern: `${V}text-\\[${size.replace('.', '\\.')}\\](?:/\\S*)?$`,
            message: `$0 is the type ramp written by hand. Use ${names.join(' or ')}.`,
          })),
          {
            pattern: HAND_WRITTEN.type,
            message: '$0 is type written by hand. A token from the package sets the size, line height, letter spacing and weight together (text-body-2, text-caption, text-h5...); if none fits, add one to the package, or say why not in an eslint-disable comment.',
          },
          ...Object.entries(cornersBySize).map(([size, names]) => ({
            pattern: `${V}rounded(?:-(?:t|r|b|l|s|e|tl|tr|br|bl|ss|se|es|ee))?-\\[${size.replace('.', '\\.')}\\]$`,
            message: `$0 is a corner written by hand. Use ${names.join(' or ')} (with the same side, if it has one).`,
          })),
          {
            pattern: HAND_WRITTEN.corner,
            message: '$0 is a corner written by hand, and no token has it. Use a corner from the package (rounded-sm 4px, rounded-md 6px, rounded-lg 8px...), or say why not in an eslint-disable comment.',
          },
          {
            pattern: HAND_WRITTEN.shadow,
            message: '$0 is a shadow written by hand. Use a shadow from the package (shadow-sm, shadow-md, shadow-focus-ring, drop-shadow-glow-success...); a shadow with no token is a missing token.',
          },
        ],
      },
    ],
    'token-spacing/no-restricted-classes': [
      'warn',
      {
        restrict: [
          {
            pattern: HAND_WRITTEN.spacing,
            message: '$0 is a size or a space written by hand. Use a step of the spacing scale (p-3, h-9, gap-2...) if one fits. Reported, not blocked.',
          },
          {
            pattern: HAND_WRITTEN.width,
            message: '$0 is a border or ring width written by hand. Use border, border-2, ring-1... if one fits. Reported, not blocked.',
          },
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: `JSXAttribute[name.name="style"] > JSXExpressionContainer > ObjectExpression > Property[key.name=${INLINE_STYLE_TOKEN_PROPERTIES}]`,
        message: 'An inline style that sets a colour, a font size, a border or a shadow is outside the token contract: use a token class. If the value is computed (a palette, a size from a prop), say why in an eslint-disable comment. Width, height and transforms are fine.',
      },
    ],
  },
}
