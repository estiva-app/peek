# Using the shared UI in Peek

**The rule: this app builds no piece of UI that `@estiva-app/ui` already owns, and owns nothing that another Estiva app would also need.** Before you write a component, a class list or a colour, you check the package. This document says how, and what the checks are. It is imported into `CLAUDE.md`, so every Claude Code session in this repository reads it at launch; a person should read it once.

It exists because the opposite has happened repeatedly and been found only by audit: a file that imported `MentionChip` on line 2 and re-typed its class list on line 118; a people picker rebuilt from scratch while `PersonChipInput` sat four directories away, used by four dialogs; four pill components at four heights for one idea; fifty-three uses of Tailwind's own type ramp beside the token ramp. None of it was carelessness. All of it was somebody writing UI without first looking at what was already there, in a place nothing checked.

---

## 1. The three kinds of UI file, and the only three

| Kind | The app knows… | Where | Example |
|---|---|---|---|
| **Shim** | nothing extra | `src/components/ui/X.tsx`, one line: `export { X } from '@estiva-app/ui'` | `Button.tsx`, `Select.tsx` |
| **Wrapper** | its data, its defaults, its copy | `src/components/ui/X.tsx`, 10–50 lines mapping Peek's types onto the package's props and forwarding the rest | `Avatar.tsx` resolves the picture through Peek's registry, then renders the package's Avatar; `PersonChipInput.tsx` maps `Person` onto the package's `ChipInput` |
| **Product** | a product object (a topic, a message, a huddle, a file) | `src/components/` and `src/components/ui/` | `MessageBody`, `ForeignObjectWidget`, `ComposeBox` |

Anything else is a mistake. In particular:

- A file that re-implements a package component, in whole or in part, is a fork. A fork needs a ticket in `estiva-ui` saying what the package lacks, and a `// FORK: <ticket>` comment at the top. Without both it is reverted. `Reaction` re-typing `Chip`'s class list with a border is the recorded example of what this rule stops.
- A product component that draws a button, a chip, a field, a menu, a tooltip, a dialog, an avatar, a divider, an empty state or a skeleton draws them **with the package's components**, through the shims in `src/components/ui/`. It never re-types their class lists.
- A second copy of anything inside this app is a shared component wanting a name. If you are about to paste a class string you can already see in another file, stop: that string is a component, and it belongs in the package.

---

## 2. Before you write: three checks, in order

**a. Does the package have it?** Read the component's page first: `node_modules/@estiva-app/ui/src/<Component>.mdx` ships with the package and has its *When*, *When not* (which names the alternative), *How*, and its Keys table. The decision table by need is `Choosing.mdx`: read it from the `estiva-ui` checkout beside this one (`../estiva-ui/stories/Choosing.mdx`) or in the package Storybook on `:6008`; from `0.6.1` it ships in the package too. **Do not use a component whose page you have not read.** For the list of exports: `grep "^export" node_modules/@estiva-app/ui/dist/index.d.ts`. Do not trust memory of it: the package has changed under this app more than once.

**b. Does Peek already wrap it?** Look in `src/components/ui/` before anywhere else. A wrapper that exists is the thing to call.

**c. Is something nearly it?** Then the package gets the prop, in a package PR, and Peek adopts the next version. That is the only route.

---

## 3. Behaviour is never written here

The package rents every behaviour from Base UI, and so does this app, through the package. No new file in `src` contains:

- `createPortal`, or its own positioning of anything that floats;
- an Escape handler, arrow-key handling, a roving tab index, outside-click logic, a focus trap;
- a hand-made `role="button"`, `role="dialog"`, `role="menu"`, `role="tooltip"`;
- a raw `<dialog>`, `<select>`, or a `<button>` / `<input>` / `<textarea>` styled by hand.

Peek still carries such code in files written before this rule (the launcher, the card popovers, the lightbox, the editor's type-ahead menus). They are being replaced by package components as the migration reaches them; **do not add to them, and do not copy from them.** The one legitimate Escape handler is inside a text editor's suggestion plugin, because the editor owns its keyboard. Everything else comes from a package component. If no package component does what you need, that is a ticket, not a `useEffect`.

**The one behaviour the package cannot give you: navigation.** A package component that takes an `href` — `RailItem`, `NavItem`, `Breadcrumb` — renders a plain `<a>` and nothing more. It cannot navigate for you, because it does not know this app's router. **An anchor left unwired reloads the whole page**: the app restarts, every read begins again, and the navigation itself goes blank until it finishes. Peek already does this correctly — `components/NavItem.tsx` wraps the package's `RailItem`, computes `active` from the location and intercepts a plain left click. **Copy it rather than writing a second one**, and keep both of the things it is careful about: modified clicks (Ctrl, Cmd, Shift, Alt, any button but the first) fall through so open-in-new-tab keeps working, and the `href` stays real so the link can still be copied and pasted. Written down because Ship did not have this rule and built its whole navigation without a wrapper — every click reloaded the app and emptied the sidebar (**SHI-20**).

---

## 4. Tokens, and the class-name trap

Colours and sizes come from the token names in `@estiva-app/ui/tailwind-preset`, never from Tailwind's defaults and never from raw values. Peek's own `tailwind.config.js` adds exactly three tokens of its own (`bg-private`, `border-private`, `logo`); nothing else is added there.

| Never | Always |
|---|---|
| `text-sm` `text-xs` `text-lg` `text-base` | `text-body-2` `text-caption` `text-h3` `text-body-1` |
| `bg-gray-100` `text-white` `bg-emerald-500` | `bg-bg-inset` `text-text-inverse` `bg-success-default` |
| `border-[rgba(63,222,140,0.3)]`, `#8B5CF6` | a token; if none fits, a token added to the package in every theme |
| `border-warning-default/40` | `border-warning-default`, or a transparent token from the package (D16; the first ones, `border-warning-outline` among them, arrive with the migration): opacity modifiers on token colours compile to nothing, and the package lint rejects them |

**The doubled prefix.** The colour tokens are named `bg-surface`, `text-primary`, `border-default`, so the classes are **`bg-bg-surface`**, **`text-text-primary`**, **`border-border-default`**. The doubled form looks wrong and is correct. `bg-surface` and `text-content` look natural, compile to nothing, and are dropped in silence.

The type ramp: `h1`–`h5`, `body-1`, `body-2`, `body-2-strong`, `caption`, `menu`, `chip`, `btn-default`, `btn-small`, `input-label`, `input-value`, `input-helper`. Tailwind's `text-sm` is 14px with a 20px line height and no weight; `body-2` is 14px at 140 %. The number matches and nothing else does.

Class lists are merged with the package's `cn()`, re-exported from `src/lib/utils.ts`, never a plain `twMerge`. **The old rule "spell sizes as arbitrary values in shared components" is retired**: the package's `cn()` knows the type ramp, so `text-body-2` survives beside `text-text-primary`. Write the token; migrate an arbitrary value to its token when you touch it.

The one deliberate exception in this app is `FrameArt`, which draws mock screenshots on Tailwind's palette and says so in its header. An exception without that comment is a defect.

**Until the lint lands, check by building.** A lint that fails the build on an unknown class, a conflicting class, or a Tailwind default is being added to the package first and then here (`eslint-plugin-better-tailwindcss`, into `eslint.config.js`). Until it is in this repository, prove a class exists the way the audits did:

```bash
npx tailwindcss -i ./src/index.css -o /tmp/check.css && grep -c '\.bg-bg-surface{' /tmp/check.css   # 1 = exists, 0 = does not
```

---

## 5. Before you call it done

- **Every UI file has a story.** A component without a story is unreviewed.
- **Render it and measure it.** Open it in Peek's Storybook (`npm run storybook`, `:6006`) and compare against the package component it is built from on `:6008`: height, radius, padding, colour. The gitignored `.verify-*.mjs` scripts in this repository drive Chrome and compare computed styles; `.verify-shots/README.txt` explains the pixel diff. "It looks right" is not a result.
- **Restart Storybook** after any change to Tailwind config, the package version, or a file you replaced with a re-export.
- **Check the theme.** A colour that resolves in the package Storybook but not here came from outside the token set. Peek renders `signal`; the Signal-only extras (washes, glows, the summary highlight, the huddle register, the wordmark, the mono stack) live in Peek's own `.signal` block and nowhere else.
- **Typecheck with `npx tsc -b`**, never `tsc --noEmit`; it is what the deploy runs.

---

## 6. When a component moves into the package

**The app file shrinks; it does not disappear.** What stays is what only Peek knows: router matching, which entries exist, the avatar registry, default copy, product counts. When nothing Peek-specific remains, the file is a one-line re-export so every import path keeps working. Callers never change. `Skeleton.tsx` is the model: the generic parts are re-exported, and only the conversation-card and huddle-card skeletons, which know what those are, stay.

The package's docs are product-agnostic; a component that needs a product noun to make sense is not going into the package, and the ticket says why.

---

## 7. For Claude sessions specifically

You will be asked to add UI. Before the first line:

1. This file is already in your context; act on it.
2. Read the component's `.mdx` in `node_modules/@estiva-app/ui/src/` and `Choosing.mdx`. Quote the *When not* line back to yourself before choosing.
3. List `src/components/ui/`.
4. Grep for the class string you are about to write. If it exists elsewhere in the app, you are writing a component, and it goes to the package.
5. Never recall a token name, a prop or an export; grep for it. A recalled name has been wrong before, and a wrong class name fails silently.
6. Give it a story. Measure it. Typecheck. Then say what you measured, not what you saw.

If a rule here blocks the work, say so and stop; do not route around it. The person asking would rather hear "the package has no X" than get a hand-rolled X.

---

## 8. Rules for particular components

Rulings that say which manner of a shared component this app uses where. Each is also on the component's own page in the package; this list is the index.

- **An empty state has two manners, and the caller decides** (Katerina, 2026-09-09, D41). When the *whole column* is empty — no topics yet, a link that leads nowhere, no conversation chosen — `EmptyState` in its `page` manner: the icon over a centred line. When one *section* of a column is empty — no related conversations under a topic, a folder with nothing in it, the Starred hint — the `section` manner: the line alone, left-aligned, no icon, at 14px. A section's emptiness is one line in a column that has other things on it; it does not get a stage of its own. A hand-written "Nothing here" paragraph or span is the `section` manner, and becomes it.

  Peek's columns are the test, not the browser window: the Folders list is a *section* when it is the narrow left column of a two-column page, and "Select a folder" is a *page*, because the right column is all there is.

- **A column keeps the frame's contract** (D46, as it applies here). Peek draws its own frame — `layouts/AppShell.tsx`, not the package's `AppShell` — so the contract binds Peek's three columns rather than a `main`. A column is a flex child and says `flex-1 min-h-0`; it takes exactly the height it is given and scrolls *inside itself*, in a region of its own. Never `h-full`, and never a scroll class written by hand.

- **A region that scrolls is `ScrollArea`, and its three class props each land on one box** (D40): `className` is the region's size and placement, `viewportClassName` is the cap — a `max-h-*` goes there and nowhere else, because on the region the viewport grows to its content and nothing scrolls — and `contentClassName` is the padding, the gap and the layout. A native `overflow-y-auto` takes its bar's width out of the content and narrows the text column the moment it appears; the package's bar is drawn over the content and takes none.

- **A floating strip of controls is `Toolbar`, and the answer is not in it** (D29). Attach, snooze, highlight are things you do *to* a draft that is still there, so they are one strip and one Tab stop. Send, Cancel and Save are answers; each keeps its own stop. `surface={false}` inside anything that already draws a box — a `Popover`, a dialog, the composer's own frame.

---

## The short version

1. Check the package (read the page). Check `src/components/ui/`. Check for a near-match.
2. Extend the package, never fork here.
3. Tokens only, doubled prefix, no opacity modifiers, package `cn()`. Prove a class exists.
4. No portals, no key handling, no roles by hand. Behaviour comes from the package.
   Except navigation: a package link is a bare anchor, so wire it to the router or the page reloads.
5. A story for every file; measure, do not eyeball.
6. Same class string twice: you wrote a component.
