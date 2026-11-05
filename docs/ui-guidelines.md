# UI Guidelines

Loaded by `/feat` only. Conventions already in use — match them.

## Theme
**White with blue.** Light is a white page, a sidebar that fades from white to
pale blue, a soft blue wash at the top of the content column, and one blue
gradient for the primary action. Dark is neutral graphite — no blue in the
surfaces, blue only in the accent and the active row. Both themes are real and
follow the OS until the reader picks one. Tailwind utility classes only, no
separate CSS files beyond [app/globals.css](../app/globals.css).

**Colours are tokens, never hex or palette classes.** `globals.css` defines
each role as an RGB triplet on `:root` and again on `.dark`;
`tailwind.config.ts` names them, so opacity modifiers work (`bg-ink/5`). A
`dark:` colour class is never needed — the token already switches.

| Token | Role |
|---|---|
| `paper` | the page: content column, fields |
| `cover` | quiet tinted surfaces: code blocks, logs, picked-file rows |
| `raised` | dialogs, toasts — anything floating over the page |
| `line` / `cover-line` | hairlines on the page / on the sidebar |
| `ink` / `ink-2` / `muted` | primary text / body text / secondary text (≥4.5:1 in both themes) |
| `accent` (+ `accent-ink`) | blue: links, the active row, focus rings (+ text on a flat accent fill) |
| `danger` | destructive buttons and error text only — never decoration |
| `ok` / `warn` | success / caution state only |

**Gradients are tokens too**, used through Tailwind's `bg-chrome`,
`bg-accent-grad` and `bg-wash`:

| Gradient | Where |
|---|---|
| `--grad-chrome` | the sidebar and the auth cover (white→pale blue; graphite in dark) |
| `--grad-accent` | the primary button, the notification count, the brand mark (the same blue in both themes, white text) |
| `--grad-wash` | the top of the content column, fading into the page |

No gradient text, and no gradient on anything else — the three above are the
whole set.

**Type is Public Sans and JetBrains Mono**, loaded by `next/font` in
[app/layout.tsx](../app/layout.tsx) and self-hosted at build time, which keeps
them inside the CSP's `font-src 'self'`. Use `font-sans` / `font-mono`; mono is
for code and logs only, never as decoration. Chrome stays at one size
(`text-sm`); rank comes from weight and colour, not from size steps. Panel
titles are `text-2xl font-bold`, lesson titles 2–2.5rem.

**No decorative numbers or red.** No circled numbers, no section numbers hung
in a margin, no red accents. The open row is a blue tint (`ui-row-on`); red is
reserved for destructive actions and errors.

**Text is the control.** Only the primary action is filled
(`ui-btn-primary`, the blue gradient); secondary actions are outlined or plain
blue text (`ui-btn-text`). No boxes where a hairline or whitespace does the
job: settings sections are ruled rows with the title in a left column, lists
are rows, grids are hairline cells.

Three base rules come with the type, in `globals.css`'s `@layer base`: `h1`–`h3`
get `text-wrap: balance`, `p` gets `text-wrap: pretty`, and anything marked
`data-numeric` (plus every `<time>`) gets tabular figures.

**Named z-index layers**, not bare numbers: `z-backdrop` (30), `z-sidebar`
(40), `z-modal` (50), `z-toast` (60), defined in `tailwind.config.ts`.

**One shadow**, `shadow-panel`, for anything that floats (dialogs, toasts),
tinted from the `--shadow` token rather than neutral black.

**Copy is labels.** A control names its action; an empty list is one muted
line. A sentence of explanation appears only where an action has a consequence
the reader must know first — sharing, access, deleting — and then it is one
short line.

## Layout and breakpoints
The shell ([components/layout/AppShell.tsx](../components/layout/AppShell.tsx))
is a two-column workspace. The sidebar hides and returns at **every** width via
the toggle in [components/layout/ContentTopBar.tsx](../components/layout/ContentTopBar.tsx): below `lg` (1024px) it is an off-canvas drawer
(`fixed` + `-translate-x-full`, dismissed by the backdrop, its collapse
control, or by opening a document), and from `lg` up the same element is `lg:static` and simply leaves
the layout when closed. One sidebar, two behaviours, not two components. It
opens by default only on wide screens, decided after mount since the server
render doesn't know the viewport.

Its width is **fixed** (`w-[18.5rem]`, capped at `85vw` while it is a drawer): it never
reflows with its contents, because a sidebar that resizes as rows open or hover
drags the reader sideways for nothing. Folder and file names **wrap** onto as
many lines as they need rather than truncating — the sidebar must never scroll
sideways to read a name.

Content follows the same rule: the reader's padding and text sizes step up at `sm`,
and anything that can be wider than the column (tables) scrolls inside its own
`overflow-x-auto` box rather than pushing the page sideways.

### Sidebar sections

Top to bottom: header, search, the **nav group**, Favorites, **Folders**,
**Recent**, the account foot.

Placement carries meaning here, so it follows one rule: **a control sits with
what it acts on.**

- **Header** — the brand (`BrandMark`, a page on the blue gradient) and the
  control that closes the panel. Nothing else.
  It previously held the notification bell, a `✕` text glyph, refresh and the
  theme toggle: four unrelated concerns filed together because there was room.
- **Nav group** ([components/layout/SidebarNav.tsx](../components/layout/SidebarNav.tsx))
  — the three *destinations*: Notifications (with its count), Discover,
  People. Icon **and label**, with an active state. Discover and People used to
  be icon-only buttons on the Folders row, which claimed a relationship to the
  folder tree that neither has.
- **Folders row** — only what acts on folders: generate, cheatsheet and
  new-folder, plus the read-only / CLI sign-in badge. A cheatsheet is listed
  in its folder under "Cheatsheets" and opens in the content column
  (`SheetView`): the pages and checks, with a chat panel beside them that edits
  the sheet.
- **Account foot** — identity first, then the app-level chrome (refresh,
  theme) right-aligned. `AccountControl` renders its *contents* only; `AppShell`
  owns the bordered row, so the chrome survives on a build with no
  collaboration, where that component renders nothing. Sign out keeps its text
  label rather than joining the icon cluster: it is the one control there you
  cannot undo without signing back in.

**Label what you navigate to; leave a glyph on what acts in place.** That is
the whole icon policy. Destinations get text; actions (new folder, generate,
refresh, theme, collapse) stay icon-only with a `title` *and* an `aria-label`.

Folders takes whatever height is left and scrolls; **Recent sits under it,
at most `max-h-[min(14rem,28vh)]`, shrinking to its rows, and hidden entirely
below 600px of viewport height**. Recent is history, not navigation: when the column cannot hold both,
the tree wins. Without that give, the fixed 224px squeezed the tree — the only
`flex-1` child — to zero on a landscape phone, the sections overlapped, and no
folder was reachable at all. The plain figure is exactly the eight rows
`lib/vault/recent.ts` caps its history at (8 × 1.75rem, a row being `text-sm`'s
1.25rem line plus `py-1`). No padding inside that box, or it eats a row; the
list collapses to its content while empty rather than holding eight blank rows
open. Recent rows are the one place in the sidebar that **truncate** instead of
wrapping, because a fixed height budget cannot absorb a name that wraps — the
`title` attribute carries the full name.

"Recent" means *finished with*, not *opened*: `AppShell` files a document when
the reader leaves it (a different selection, or `pagehide`), so the file on
screen is never also listed above as history.

### The content column's top bar

[components/layout/ContentTopBar.tsx](../components/layout/ContentTopBar.tsx)
is a 52px sticky strip at the top of `<main>`, level with the sidebar header. It holds two things:

- **The sidebar toggle, only while the sidebar is hidden.** Open, the sidebar
  carries its own collapse control in its header; rendering both put two
  buttons for one job on either side of the divider, which reads as an accident.
- **The open document's `folder / title`.** Blank while a panel has taken the
  column — the panels render their own `PanelHeader` h1, and naming them here
  too would put every panel's title on screen twice.

It replaced a round button that floated *over* the document at top-left plus
the permanent `pt-12` every page carried to dodge it — a control sitting on top
of the thing it was meant to leave alone, and a reserved gap that existed
whether or not the control did. Neither exists now; don't reintroduce either.

### Panels in the content column

The account editor, folder discovery, the people search panel, notifications
and a folder's sharing console render **inside the workspace's content
column**, not as a navigation — `AccountPanel`, `DiscoverPanel`,
`PeoplePanel`, `NotificationsPanel` and `FolderManagePanel` each take an
optional `onClose`, and `AppShell` holds one `overlay` value (never a boolean
per pane) so two cannot be open at once; the union of what it can hold is the
`Overlay` type at the top of `AppShell.tsx`, spelled once. Their routes
(`/account`, `/discover`, `/people`, `/notifications`,
`/vault/[folder]/manage`) still exist and render the same component without
`onClose`, for a deep link or an auth `?next=`. **A new panel route must also
be added to `PROTECTED_EXACT` in [middleware.ts](../middleware.ts)** — that
set, not the panel, is what makes the page redirect a signed-out visitor to
sign-in.

Every one of them opens with
[components/layout/PanelHeader.tsx](../components/layout/PanelHeader.tsx) —
title, optional subtitle, an optional count `badge` and panel-specific
`actions`, then the way out. It is what enforces the button-versus-link rule
below; don't hand-roll a panel heading. A control that opens a panel in place is a `<button>`; the same
control on a page that must navigate is an `<a>` — a link that doesn't navigate
and a button that does are both lies about what will happen.

## App icon
[app/icon.svg](../app/icon.svg) is the master mark (a page + lens on the
project blue, `#2563eb`). Everything else is generated from it and should be
regenerated, never hand-edited: `app/favicon.ico` and `app/apple-icon.png`
(Next.js serves both from `app/` automatically) and `desktop/icons/*` via
`npx tauri icon <png> -o desktop/icons`. The splash screen
([desktop/assets/splash.html](../desktop/assets/splash.html)) inlines the same
paths.

## Shared control classes
The same input and button were being spelled several slightly different ways
per page, so the shapes live once in [app/globals.css](../app/globals.css)
under `@layer components`. Compose these instead of re-deriving a control:

| Class | Use |
|---|---|
| `ui-field` (+ `ui-field-sm`) | every text input, select and textarea |
| `ui-btn` + `ui-btn-primary` / `-secondary` / `-ghost` / `-text` / `-danger` / `-danger-outline` | buttons; add `ui-btn-sm` or `ui-btn-xs` for row-height and dense variants. `-text` is a link-weight blue action with no box |
| `ui-icon-btn` (+ `ui-icon-btn-danger`) | square icon-only controls |
| `ui-row` | a list/tree row that tints on hover (colour only, never moves) |
| `ui-row-on` | the open row or active destination: blue tint, blue text |
| `ui-reveal` | a row action that appears on `group-hover` |
| `ui-focus` | a visible focus ring on anything not covered above |
| `ui-scroll` | a pane that scrolls: smooth `scroll-behavior` + contained overscroll |
| `ui-rise` | enter animation (fade + 4px lift) for a row or card arriving in a list |
| `ui-card` (+ `ui-card-hover`) | a hairline-bounded region, no fill — only where a boundary carries meaning |
| `ui-cells` | a grid of whole cells sharing hairlines (Discover, profile folders). Add the column count (`sm:grid-cols-2 lg:grid-cols-3`) |
| `ui-badge` | a small count or status label. Square, hairline, **not** a pill |
| `ui-section-title` | an 11px uppercase section label inside the sidebar or a diagram |
| `ui-empty` | the single muted line that stands in for an empty list |
| `ui-skip-link` | off-screen until focused; first in the tab order on every page |

Two rules that come with them:

- **Focus is always visible.** `outline-none` on its own is a bug; every one of
  the classes above puts a `focus-visible` ring back. The two deliberate
  exceptions are the sidebar search input and the chat composer, where the
  wrapper carries `ui-field` and the ring via `focus-within` so the whole box
  lights up instead of the bare input.
- **A field wrapper takes the ring**, not the input inside it.
- **Every page marks its main region `id="main"`.** The skip link in
  [app/layout.tsx](../app/layout.tsx) is the first thing in the tab order on
  every page and jumps to it, so a keyboard reader doesn't walk the whole
  sidebar tree to reach the document. A page with no `#main` silently breaks
  that link.

## Motion
Transitions are 120–180ms `ease-out` for hover and focus, 200–280ms for
enter/exit, and only ever on colour, opacity and transform — never on `width`,
`height`, or anything else that reflows. `ui-reveal` fades a row action in
while keeping it in the layout at all times, precisely so revealing it cannot
resize a row or the fixed-width sidebar (the old `hidden group-hover:flex`
did). One `@media (prefers-reduced-motion: reduce)` block in `globals.css`
neutralises all of it for anyone who asked their OS for less motion — including
`ui-rise`, `animate-pulse` and `ui-scroll`'s smooth scrolling.

Lists animate in with `ui-rise` plus an inline `animationDelay` to stagger them:
`style={{ animationDelay: \`${Math.min(i, 8) * 25}ms\` }}`. **Cap the index.**
Past the first handful the delay stops reading as sequence and starts delaying
readability, which is why every call site clamps. 25ms per row for sidebar
rows and list items, 40ms per card for settings sections. Two transforms that
replace a cut: the tree's disclosure arrow is one SVG chevron that rotates, not two
glyphs that swap, and an opened folder's contents fade and lift in rather than
appearing.

## Components
- **Modals**: every modal wraps [components/modals/Modal.tsx](../components/modals/Modal.tsx)
  (dimmed backdrop, raised sheet, title with a close button, Escape and
  click-outside to close; `size="md"` for the generation dialogs). Don't build
  a one-off modal shell.
- **Destructive confirmation**: every delete/disconnect action goes through
  [components/modals/ConfirmModal.tsx](../components/modals/ConfirmModal.tsx)
  — never a native `confirm()`, never delete without it.
- **Toasts**: success/failure feedback after an action goes through
  [components/toast/ToastProvider.tsx](../components/toast/ToastProvider.tsx)'s
  `useToast()` hook (`toast.success(...)` / `toast.error(...)`), mounted
  once at the root layout. A toast is a raised sheet with a small green
  (success) or red (error) dot, never a coloured box. Don't build a second notification mechanism.
- **Hover-reveal actions**: row-level destructive icons (folder/lesson
  delete) are hidden by default, shown on `group-hover` — see
  [components/sidebar/FileTreeNode.tsx](../components/sidebar/FileTreeNode.tsx)
  for the pattern (`group` on the row, `ui-reveal` on the icon button).
- **File rows**: lesson/quiz rows in the tree carry the document's sequence
  number (`seq`, rendered `01`, `02`, …) as a faint prefix, so the sidebar
  reads in generation order; the open document's row is `ui-row-on`.
- **Uploads**: every file input is
  [components/generate/FileDrop.tsx](../components/generate/FileDrop.tsx) — a
  dashed drop target that is also a native `<input type="file">`, with the
  picked files listed under it. Don't style a bare file input.
- **Generation dialog**: folder, a Lesson / Quiz / Pictures segmented switch,
  the drop zone, then a "Runs with" row naming where the run happens (today
  always Claude Code on this computer — the slot a future service picker
  takes), then one primary button. The run's log is a quiet cover-tinted box,
  not a terminal costume.
- **Icons**: hand-rolled inline SVG components under
  [components/icons/](../components/icons/) (e.g. `TrashIcon`), all on a 24px
  grid at `strokeWidth="1.75"`, no icon library dependency. Never a Unicode
  glyph (✕ ▸ ✓) standing in for one.
- **Notifications**: everything waiting on the reader's answer — folder
  invitations, incoming follow requests, offered tags — is one merged,
  newest-first list in
  [components/collab/NotificationsPanel.tsx](../components/collab/NotificationsPanel.tsx),
  opened by the always-present Notifications row in the sidebar's nav group
  (`SidebarNav`). Both read one copy of the list from
  `NotificationsProvider`, which wraps the whole shell: a second fetch for the
  badge would disagree with the panel the moment an item was answered. They
  are *actionable* items, never a feed — there is no read/unread flag, an item
  leaves the list by being answered and nothing else, and no table backs it
  (the three endpoints in [api-contract.md](api-contract.md) already existed).
  **Don't add a notification block that renders nothing when empty**: three of
  those used to stack in the sidebar, which made the surface unreachable
  exactly when someone went looking for it, and pushed the folder tree down
  the sidebar whenever it wasn't.
- **Auth pages**: sign-in, sign-up and reset share
  [components/auth/AuthShell.tsx](../components/auth/AuthShell.tsx) — on wide
  screens the sidebar's gradient field with the mark and one line on what the app does,
  beside the form on the page; on a phone, just the mark and the form. Each step is a real `<form>` with a
  `type="submit"` button, not a keydown handler: autofill, "save this
  password" and a phone keyboard's Go key all key off the form. Use
  `min-h-dvh`, never `min-h-screen` — iOS Safari's `100vh` is the height with
  the toolbars hidden, so a centred column jumps as they slide away.
- **Loading states**: [components/layout/Skeleton.tsx](../components/layout/Skeleton.tsx)
  — `SkeletonPanel` for a settings-style page, `SkeletonCard`, `SkeletonRows`
  for a sidebar list, `SkeletonLine`/`SkeletonCircle` to compose one by hand.
  A skeleton mirrors the layout that is coming, at the same sizes, in the same
  order, at the same width, so the content landing moves nothing. **Don't add a
  centred spinner** — it says "wait" and nothing else; these say what the reader
  is waiting for. They pulse rather than shimmer, because a travelling highlight
  competes with the page's own enter transitions.

## Collaboration UI
Components live in `components/collab/`. Model and permission rules:
[collaboration.md](collaboration.md).

| Element | Style |
|---|---|
| `owner` badge | `ui-badge border-accent/40 text-accent` |
| `editor` badge | `ui-badge text-ink-2` |
| `viewer` badge | `ui-badge text-muted` |
| Tag chip | `rounded border border-line text-ink-2`, square — not a pill |
| Active tag filter | `border-accent/40 bg-accent/10 text-accent` |
| Pending state (invite/request) | `text-warn` |

- **Folder grids** (Discover, a profile's folders) are `ui-cells`: hairline
  cells with the name first, owner and note count under it, actions as blue
  text.
- **The folder console and Account** are ruled rows: section title in a left
  column, controls on the right, no cards.
- **Member rows** reuse the hover-reveal pattern above: `group` on the row,
  `ui-reveal` on the remove button.
- **Removing a member, leaving a folder, deleting a folder** all go through
  `ConfirmModal` — no exceptions, same rule as lesson deletion.
- **A hidden control is not a permission.** Grey out or omit write controls for
  a `viewer`, but never assume that is what stops the action — the database
  does. Show the server's error via `toast.error(...)` when it refuses.
- **Empty states matter more here than elsewhere**: "no members yet", "no
  pending requests", "no folders match" are the normal case early on. Write
  them as a muted single line, not an illustration.

## Rendering generated content
Lesson HTML is never inserted via `dangerouslySetInnerHTML`. It's parsed
and walked node-by-node in
[components/viewer/HtmlRenderer.tsx](../components/viewer/HtmlRenderer.tsx),
mapping each allowed tag to a real React element. Four element types get
intercepted for richer rendering:

- `<blockquote>` beginning with a callout label → `Callout` component.
- `<div class="mermaid">` → `Mermaid` component (client-side SVG render).
- `<div class="viz">` JSON `{type, title?, data}` → `VizRenderer`, which
  dispatches to the correct component via the visualization registry.
- `<div class="viz-{type}">` legacy JSON → legacy dispatch (backward compat;
  existing lessons continue to work without modification).

The reader is not Tailwind Typography. `LessonViewer` centres one 44rem
column and `HtmlRenderer` wraps the document in `.lesson` (sizes, lists,
tables, code) in `globals.css`. Overview, Summary and every `Concept: …`
heading are major sections; a Concept drops the word "Concept" on screen (kept
in the DOM, visually hidden, so search hits still match it). The repeated
sub-headings (How it Works, Example, Gotcha) are bold body-size. A callout is a
faint wash in its kind's colour with a small label above the text — no side
stripe. Diagrams
and visualizations sit in a hairline frame with an uppercase label title; Mermaid's
colours mirror the tokens in `Mermaid.tsx`.

### Visualization registry

[components/viewer/visualizations/registry.tsx](../components/viewer/visualizations/registry.tsx)
maps every viz type string to a render function. `VizRenderer` looks up the
type, merges the outer `title` into `data`, and calls the function.

| Type | Component | Notes |
|---|---|---|
| `process-flow` / `pipeline` | `ProcessFlow` | linear step chain |
| `timeline` / `lifecycle` | `Timeline` | ordered events with inline desc |
| `layer-stack` | `LayerStack` | stacked colored cards, top = first |
| `block-diagram` | `BlockDiagram` | CSS grid of labeled blocks |
| `memory-layout` | `MemoryLayout` | narrow column, high→low address |
| `comparison-table` | `ComparisonTable` | N×M structured comparison |
| `hierarchy-tree` / `tree` | `HierarchyTree` | recursive indented tree |
| `sequence` / `state-machine` / `decision-tree` / `graph` / `network-topology` | Mermaid | `data.mermaid` = source string |

**To add a new viz type** — two steps, no other files need to change:
1. Create `components/viewer/visualizations/MyComponent.tsx`.
2. Add one line to `registry.tsx`: `"my-type": (d) => <MyComponent data={d as MyData} />,`

Then tell `/lect` to document the JSON shape in `docs/html-output-contract.md`.

### Larger motion
`framer-motion` for the lesson-switch fade/slide
([components/viewer/LessonViewer.tsx](../components/viewer/LessonViewer.tsx))
and the Mermaid diagram fade-in. Keep transitions short (~0.3s) and subtle
— this is a study tool, not a marketing site.
