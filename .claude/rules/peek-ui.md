---
paths:
  - "src/**/*.tsx"
  - "src/index.css"
  - "tailwind.config.js"
---

# Peek's UI files

The `estiva-ui` skill covers the package: search, read the page, never hand-roll.
This file is what only Peek adds.

## The three kinds of UI file, and the only three

| Kind | The app knows… | Where | Example |
|---|---|---|---|
| **Shim** | nothing extra | `src/components/ui/X.tsx`, one line: `export { X } from '@estiva-app/ui'` | `Button.tsx`, `Select.tsx` |
| **Wrapper** | its data, its defaults, its copy | `src/components/ui/X.tsx`, 10–50 lines mapping Peek's types onto the package's props and forwarding the rest | `Avatar.tsx` resolves the picture through Peek's registry, then renders the package's Avatar; `PersonChipInput.tsx` maps `Person` onto the package's `ChipInput` |
| **Product** | a product object (a topic, a message, a huddle, a file) | `src/components/` and `src/components/ui/` | `MessageBody`, `MessageCard`, `PartCard` |

- A product component that draws a button, a chip, a field, a menu, a tooltip, a dialog, an avatar, a divider, an empty state or a skeleton draws them **with the package's components**, through the shims in `src/components/ui/`. It never re-types their class lists.
- A second copy of anything inside this app is a shared component wanting a name. If you are about to paste a class string you can already see in another file, stop: that string is a component, and it belongs in the package.

## When a component moves into the package

**The app file shrinks; it does not disappear.** What stays is what only Peek knows: router matching, which entries exist, the avatar registry, default copy, product counts. When nothing Peek-specific remains, the file is a one-line re-export so every import path keeps working. Callers never change. `Skeleton.tsx` is the model: the generic parts are re-exported, and only the conversation-card and huddle-card skeletons, which know what those are, stay.

The package's docs are product-agnostic; a component that needs a product noun to make sense is not going into the package, and the ticket says why.

## Tokens and classes

- Peek's own `tailwind.config.js` adds four tokens of its own (`bg-private`, `border-private`, `logo`, `highlight-summary`); nothing else is added there.
- Merge class lists with the package's `cn()`, re-exported from `src/lib/utils.ts`. Never a plain `twMerge`: it drops the token sizes.
- **Check the theme.** A colour that resolves in the package Storybook but not here came from outside the token set. Peek renders `signal`; the Signal-only extras (washes, glows, the summary highlight, the huddle register, the wordmark, the mono stack) live in Peek's own `.signal` block and nowhere else.

## Keeping a refused line

The reason goes on the line above. Two forms, one per lint:

- A gate rule (`npm run lint:rules`): `// @estiva-escape(<rule>): <reason>`, or `{/* @estiva-escape(<rule>): <reason> */}` in JSX, naming the rule it keeps off. Never `eslint-disable`.
- A token rule (`npm run lint:tokens`): `// eslint-disable-next-line <rule> -- @estiva-escape: <reason>`.

## Only offer actions that can succeed

An action appears only in contexts where it works; the enabling surface advertises the capability.
