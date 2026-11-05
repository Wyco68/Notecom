---
name: Notecom
description: Lecture notes in plain language, read in one calm white-and-blue column.
colors:
  paper: "#ffffff"
  cover: "#f1f5fd"
  raised: "#ffffff"
  line: "#e4e9f2"
  cover-line: "#d6e0f2"
  ink: "#111827"
  ink-2: "#374151"
  muted: "#586070"
  accent: "#2563eb"
  accent-strong: "#1d4ed8"
  accent-ink: "#ffffff"
  accent-grad-top: "#3478f6"
  chrome-top: "#f8faff"
  chrome-bottom: "#dfe9fd"
  wash-top: "#e6eefd"
  danger: "#c82832"
  ok: "#168048"
  warn: "#a05a08"
  shadow-tint: "#1e3264"
  dark-paper: "#0e0e10"
  dark-cover: "#1a1a1d"
  dark-raised: "#18181b"
  dark-line: "#27272b"
  dark-cover-line: "#2c2c31"
  dark-ink: "#ededf0"
  dark-ink-2: "#cdcdd3"
  dark-muted: "#9a9aa3"
  dark-accent: "#6ea5ff"
  dark-chrome-top: "#1d1d21"
  dark-chrome-bottom: "#111113"
  dark-wash-top: "#1c1c20"
  dark-danger: "#f87171"
  dark-ok: "#5ec88c"
  dark-warn: "#ecb25a"
typography:
  lesson-title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  lesson-section:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.7
  chrome:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.08em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.875em"
    fontWeight: 400
rounded:
  code: "4px"
  md: "6px"
  lg: "8px"
  pre: "10px"
  xl: "12px"
  full: "9999px"
spacing:
  row-y: "4px"
  nav-row-y: "6px"
  control-x: "12px"
  control-y: "8px"
  cell: "20px"
  dialog: "24px"
  sidebar-width: "296px"
  top-bar-height: "52px"
  reading-measure: "44rem"
components:
  button-primary:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.chrome}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  button-text:
    textColor: "{colors.accent}"
    rounded: "{rounded.lg}"
    padding: "6px 4px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.chrome}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  row:
    textColor: "{colors.ink-2}"
    typography: "{typography.chrome}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  row-active:
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  icon-button:
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    size: "28px"
  badge:
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
  dialog:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "24px"
  top-bar:
    textColor: "{colors.ink}"
    height: "52px"
---

# Design System: Notecom

## Overview

**Creative North Star: "The Answer Booklet in Daylight"**

Notecom is a quiet white-and-blue study tool. The note fills one calm centred column; the chrome recedes into a soft blue gradient; blue marks only what is open or primary. The reader is usually behind on something, so nothing on screen competes with the paragraph they came for.

The light theme is a white page with a pale blue wash falling from the top of the content column, beside a sidebar that fades from near-white to pale blue. The dark theme is neutral graphite: no blue in any surface, blue only in the accent, the open row and the one filled button. Chrome sits at a single size and ranks by weight and colour. Text is the control; hairline cells and ruled rows stand where another app would put cards.

The system explicitly refuses the old dark code-editor look, the grey-sidebar notes-app template, a blue-tinted dark theme, decorative numbering, and red used as decoration.

**Key Characteristics:**
- One reading column at 44rem, centred, bold title, blue wash behind its top.
- A fixed 296px gradient sidebar that never reflows.
- Exactly three gradients: chrome, accent, wash.
- One filled control per view: the blue-gradient primary button.
- Hairlines and tints instead of boxes; one soft shadow for anything floating.
- Neutral graphite dark theme with the same blue accent.

## Colors

White and graphite surfaces carrying a single blue voice; red, green and amber exist only as state.

Every colour is an RGB-triplet custom property on `:root` and again on `.dark` in `app/globals.css`, named once in `tailwind.config.ts`. Components use the role name (`ink`, `accent`, `line`) and the theme switches underneath; the `dark-*` keys above record the dark values of the same roles.

### Primary
- **Study Blue** (`accent`): links, focus rings, the open-row tint, the active tag filter, blue text actions, the selection highlight and the input caret.
- **Deep Study Blue** (`accent-strong`): text on a blue tint, so the open row holds AA contrast; the bottom stop of the accent gradient. In dark it equals the accent (`dark-accent`).
- **Accent Gradient** (`accent-grad-top` to `accent-strong`, 180deg): the primary button, the notification count and the brand mark. The same blue in both themes, always with white text.
- **Soft Daylight Blue** (`dark-accent` in dark): the lifted blue that carries the accent on graphite.

### Neutral
- **Paper** (`paper` / `dark-paper`): the page, the content column, fields.
- **Cover** (`cover` / `dark-cover`): quiet tinted surfaces: code blocks, the generation log, picked-file rows.
- **Raised** (`raised` / `dark-raised`): dialogs and toasts.
- **Hairline** (`line` / `dark-line`) and **Cover Hairline** (`cover-line` / `dark-cover-line`): rules on the page and on the sidebar respectively.
- **Ink** (`ink`), **Ink 2** (`ink-2`), **Muted** (`muted`): primary text, body text, secondary text. All three hold at least 4.5:1 in both themes; light muted was darkened to `#586070` in the finish round for that reason.
- **Chrome Gradient** (`chrome-top` to `chrome-bottom`; `dark-chrome-top` to `dark-chrome-bottom`): the sidebar and the auth cover.
- **Wash Gradient** (`wash-top` fading to transparent over 26rem; `dark-wash-top` in dark): the top of the content column.
- **Shadow Tint** (`shadow-tint`; pure black in dark): the colour every shadow and the dialog backdrop are mixed from.

### State
- **Danger** (`danger` / `dark-danger`): destructive buttons and error text only.
- **Ok** (`ok` / `dark-ok`) and **Warn** (`warn` / `dark-warn`): success and caution, the pending state of an invite, and the Remember / Common Mistake callouts.

### Named Rules
**The Three Gradients Rule.** Chrome, accent, wash — that is the whole set. No gradient text, no gradient on any other surface.

**The Red Means Loss Rule.** Red appears only on a destructive action or an error. Never as an accent, a highlight or a brand colour.

**The Graphite Dark Rule.** Dark surfaces are neutral grey with no blue cast; blue in dark is reserved for the accent.

**The Tokens Only Rule.** Components name roles, never hex or Tailwind palette classes, and never need a `dark:` colour variant. The brand mark and app icon's blues and Mermaid's theme objects are the only literal mirrors of the tokens.

## Typography

**Display Font:** Public Sans (with system-ui, sans-serif)
**Body Font:** Public Sans
**Label/Mono Font:** JetBrains Mono, for code and the generation log only

**Character:** One plain, slightly institutional grotesque does everything, like a well-set reference manual; mono appears only where the content is literally code. Both are self-hosted by `next/font`.

### Hierarchy
- **Lesson title** (700, 2rem on phones, 2.5rem from 640px, line-height 1.12, -0.022em): the h1 of a note.
- **Headline** (700, 1.5rem, tight tracking): every panel title (`PanelHeader`) and auth page title.
- **Lesson section** (700, 1.375rem, 1.3): Overview, Summary and each Concept heading, which drops the word "Concept" on screen.
- **Title** (700, 1rem): dialog titles; folder names in a cell at 600.
- **Lesson body** (400, 1rem on phones, 1.0625rem from 640px, line-height 1.7, ink-2): the note, held to the 44rem column. Repeated sub-headings (How it Works, Example) are body size at weight 650.
- **Chrome** (400–600, 0.875rem): every sidebar row, button, field, top bar and list. Rank comes from weight and colour, never from a size step.
- **Label** (600, 11px, 0.08em, uppercase, muted): sidebar list headings (Folders, Recent, Quizzes, Cheatsheets) and diagram titles. Callout kind labels use the same size at 700 in their kind's colour.

Headings get `text-wrap: balance`, paragraphs `pretty`, and every `<time>` and `data-numeric` element tabular figures.

### Named Rules
**The One Size Chrome Rule.** All chrome is 0.875rem. To make something rank higher, change its weight or colour.

**The Mono Is Code Rule.** JetBrains Mono appears only on code, `pre` and logs; never as a decorative or "technical" voice.

## Layout

A two-column workspace (`h-dvh`): a fixed 296px sidebar (capped at 85vw as a phone drawer) and a scrolling content column. Below 1024px the sidebar is an off-canvas drawer over a dimmed backdrop; from 1024px it sits in the layout and leaves it when closed. Its width never changes with content; names wrap rather than truncate (Recent is the single truncating list, under a fixed height budget, hidden below 600px viewport height).

The content column opens with a 52px sticky translucent top bar (paper at 75% with a backdrop blur, hairline below) showing `folder / title`, level with the sidebar header. The reader is one 44rem centred column, 20px side padding on phones and 32px from 640px. Panels (Home, Discover, People, Notifications, Account, Manage) use the same column with a `PanelHeader`.

Spacing is Tailwind's 4px grid. Sidebar rows are 4px vertical (nav rows 6px) by 8px horizontal; controls are 8px by 12px; a cell is 20px inside; a dialog 20px, 24px from 640px. Folder grids are hairline cells that repack by whole columns (`sm:grid-cols-2 lg:grid-cols-3`). Settings are ruled rows with the section title in a left column. Tables scroll inside their own box rather than widening the page.

Lists enter with `ui-rise` (fade plus 4px lift, 220ms, `cubic-bezier(0.22, 1, 0.36, 1)`), staggered 25ms per row with the index capped at 8. Hover and focus transitions are 150ms ease-out on colour, opacity and transform only. One reduced-motion block neutralises all of it.

### Named Rules
**The Nothing Reflows Rule.** Hover, reveal and open states change colour or opacity only; a row action is always in the layout and fades in (`ui-reveal`).

## Elevation & Depth

Flat by default with tonal layering: cover-tinted surfaces and hairlines carry structure, the chrome gradient separates the sidebar, and the wash gives the top of the page light. Depth appears only on what floats over the page.

### Shadow Vocabulary
- **Panel** (`0 1px 2px rgb(var(--shadow) / 0.10), 0 12px 32px -12px rgb(var(--shadow) / 0.30)`): dialogs, toasts, the focused skip link. Tinted blue-navy in light, black in dark.
- **Primary lift** (`0 1px 2px rgb(29 78 216 / 0.25), inset 0 1px 0 rgb(255 255 255 / 0.15)`): only on the blue-gradient primary button.
- **Dialog backdrop** (`rgb(var(--shadow) / 0.45)`): behind every modal.

### Named Rules
**The One Shadow Rule.** Anything that floats uses the panel shadow; nothing on the page itself is lifted.

## Shapes

Gently rounded, never pill-shaped. Rows and icon buttons are 6px; fields, buttons and the drop zone 8px; cards, cell grids, dialogs and callouts 12px; code blocks 10px and inline code 4px. Only avatars and tiny status dots are fully round. Badges and tag chips are square-cornered with a hairline. Borders are 1px hairlines in `line` (page) or `cover-line` (sidebar); the drop zone is the single dashed border. Icons are inline SVG on a 24px grid at a 1.75 stroke.

### Named Rules
**The No Pill Rule.** Counts, roles and tags are small square hairline badges; the notification count is the same square badge filled with the accent gradient.

## Components

### Buttons
Text first; one fill per view.
- **Shape:** gently rounded (8px), 0.875rem medium, 8px by 12px (`ui-btn-sm` 6px by 12px, `ui-btn-xs` 4px by 8px at 0.75rem).
- **Primary:** the accent gradient with white text and the primary lift; hover brightens 10%.
- **Secondary:** hairline outline on paper, ink text; hover darkens the border and adds a 3% ink tint.
- **Ghost:** ink-2 text, 5% ink tint on hover.
- **Text:** blue text, no box, 8% accent tint on hover — the default for actions in lists and cells ("Open", "Join", "Back to notes").
- **Danger / Danger outline:** solid danger fill, or a danger hairline with danger text; only for destructive actions, always behind `ConfirmModal`.
- **Focus:** a 2px ring at 60% accent (60% danger on danger buttons). Disabled is 50% opacity.

### Icon buttons
Square, 6px radius, muted glyph that turns ink on a 6% ink tint. Danger variant tints red on hover. Every one carries a `title` and an `aria-label`.

### Rows and navigation
- **Row:** 6px radius, 5% ink tint on hover, colour only.
- **Open row / active destination:** 10% accent tint, medium weight, `accent-strong` text.
- **Sidebar nav:** Home, Notifications, Discover, People — 16px icon plus label, muted icon at rest. The Notifications count is a square badge on the accent gradient.
- **File tree:** folder names semibold with a rotating SVG chevron; children indent behind a cover-line rule. Lesson and quiz rows carry a faint inline two-digit sequence prefix (`01`) in muted 0.75rem tabular figures; share, rename and delete fade in on hover.

### Inputs / Fields
- **Style:** 1px hairline on paper, 8px radius, 8px by 12px, muted placeholder, blue caret.
- **Focus:** border turns accent plus a 2px ring at 20% accent. A wrapper (sidebar search, chat composer) takes the ring through `focus-within`.
- **Upload:** a dashed 8px drop zone with an upload icon, label and hint; picked files list beneath on cover-tinted rows.

### Cards / Containers
- **Cells:** hairline grids of whole cells (12px outer radius, 20px inside), name first, owner and count in muted 13px, actions as blue text; a 3% accent tint on hover.
- **Cards:** a 12px hairline region with no fill, only where a boundary carries meaning.
- **Dialogs:** raised, 12px, hairline, panel shadow, 1rem bold title with a close icon, `ui-rise` entrance.

### Badges and chips
11px semibold tabular, square hairline badges. Owner role is accent-bordered and accent text; editor ink-2; viewer muted. The active tag filter is a 10% accent tint with an accent border.

### Lesson reader
`.lesson` in a centred 44rem column with the wash behind its top. Lists use muted markers; tables rule each row with a hairline and the header with 35% ink; code sits on cover at 10px radius. A callout is a faint wash in its kind's colour (accent, ok, warn or ink) at 12px radius with its kind label above the text, no side stripe. Diagrams and visualizations sit in a hairline frame with a label title; Mermaid's colours mirror the tokens.

### Toasts
A raised sheet with the panel shadow and a 6px dot — ok for success, danger for error. Never a coloured box.

## Do's and Don'ts

### Do:
- **Do** name colours by role (`ink`, `accent`, `line`) and let the token switch themes.
- **Do** keep exactly one filled control per view: the accent-gradient primary button.
- **Do** mark the open row with the 10% accent tint and `accent-strong` text.
- **Do** keep chrome at 0.875rem and rank by weight and colour.
- **Do** use hairline cells, ruled rows and whitespace before reaching for a card.
- **Do** use the panel shadow for anything that floats, and nothing else.
- **Do** draw icons as inline SVG on the 24px grid at a 1.75 stroke.
- **Do** keep the reading column at 44rem, centred, with the wash behind its top.

### Don't:
- **Don't** add a fourth gradient, gradient text, or a gradient on any surface other than the sidebar, auth cover, primary button, notification count, brand mark and page wash.
- **Don't** tint dark surfaces blue; dark is neutral graphite.
- **Don't** use red for anything but a destructive action or an error.
- **Don't** put circled numbers or numbers hung in a margin anywhere; the tree's inline `01` prefix is the only sequence number.
- **Don't** use pill badges or rounded-full chips.
- **Don't** let a Unicode glyph (✕ ▸ ✓) stand in for an icon.
- **Don't** animate width, height or anything that reflows the fixed sidebar.
- **Don't** add a side stripe to a callout or a terminal costume to the generation log.
