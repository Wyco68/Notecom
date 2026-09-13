# Product

Written by `/impeccable init` from this repo's own documentation — README.md,
CLAUDE.md, SPECIFICATION.md, docs/architecture.md and docs/ui-guidelines.md
already answered every strategic question, so nothing here is guessed.

## Register

product

## Users

A student on an Information Systems & Network Engineering programme, working
through their own lecture material and their classmates'. Two contexts, one
app:

- **Reading** — most of the time. Long sessions with one note open, moving
  between folders, searching across everything they can read. Often the night
  before an exam, often on a laptop, sometimes on a phone.
- **Generating** — occasionally, and only on a machine that has their own
  Claude Code CLI signed in (the desktop app, or their own checkout). They drop
  in a lecture PDF or slide deck and get a note or quiz back. The hosted web
  app cannot do this and says so rather than offering a button that fails.

A third, lighter context: **the social layer**. Each person has a profile;
Home is a feed of what they can already read — new notes in their folders, and
public folders published by people they follow. Folders stay the unit of
sharing: ask to join, accept an invitation, or start in the featured courses a
new account is onboarded into. Reading a folder always takes membership; the
social layer adds ways to *find* things, never ways around that.

## Product Purpose

Turn lecture slides and PDFs into study notes written in plain, high-school-level
language while keeping every technical term correct, then make those notes
readable, searchable and shareable.

The app is deliberately not the author. Claude Code writes the content
(`/lect`, `/quiz`), grounded strictly in the file it was given; the app reads,
organizes and shares what Claude Code wrote. Success is a student getting to
the paragraph they need without thinking about the software — and trusting that
what they read is what was in their lecture.

## Brand Personality

**Precise, unadorned, quietly technical.**

The voice of the interface is the voice of a good reference manual: it says
what a control does and what will happen, and never sells. Copy is sentence
case, active voice, no exclamation marks, no "Oops!". Where an action has a
consequence the copy states the consequence — "accepting shares every folder
tagged this way with you" — because the alternative is a reader agreeing to
something they did not understand.

Emotionally the target is **calm confidence under time pressure**. The reader
is usually behind on something. The interface should never add to that.

## Anti-references

- **Marketing-site energy inside the app.** No hero sections, no gradient
  text, no big scroll-driven reveals, no "Elevate your learning" copy. The
  ui-guidelines doc says it plainly: this is a study tool, not a marketing site.
- **The SaaS dashboard template.** Stat tiles, three equal feature cards,
  pill badges on every noun, an illustrated empty state for a list that is
  normally empty anyway.
- **Notion / Google Docs surface density.** Not because they are bad, but
  because this is a reader first: chrome should recede, not multiply.
- **Anything that reflows on hover.** A sidebar that resizes as rows open, a
  row that grows when its action appears. Both existed here and both were
  removed on purpose.
- **A control that only appears once you no longer need it.** Three
  notification blocks used to render nothing when empty; that is the failure
  this product treats as a design bug, not a nicety.

## Design Principles

1. **The document is the product; everything else is chrome.** Any control
   that competes with the note for attention is in the wrong place or the
   wrong size. Chrome recedes; content does not.

2. **A control tells the truth about what it will do.** A link navigates, a
   button does not. A hidden control is not a permission — the database is.
   Where an action grants access, the copy says so before the click.

3. **Never move the reader for free.** No layout that reflows on hover or
   focus, no width that changes with its contents, no transition on anything
   that triggers reflow. Colour, opacity and transform only.

4. **Place a control by what it acts on.** A folder action belongs to the
   folder list; a destination belongs to navigation; app-level chrome belongs
   with the app, not with whatever list it happens to sit above.

5. **Empty is the normal early state.** Write it as one muted line that says
   what will land there, never as a failure or an illustration.

## Accessibility & Inclusion

- **WCAG 2.1 AA** is the floor. Body text ≥4.5:1, large text ≥3:1, in both
  themes.
- **Focus is always visible.** `outline-none` with nothing put back is treated
  as a bug; every shared control class restores a `focus-visible` ring. A field
  wrapper takes the ring, not the bare input inside it.
- **Reduced motion is honoured globally.** One `prefers-reduced-motion` block
  in `globals.css` neutralises every animation, transition and smooth scroll,
  including list stagger and skeleton pulse.
- **Keyboard first-class.** A skip link is the first thing in the tab order on
  every page and jumps to `#main`; every page marks its main region.
- **Both themes are real.** Light and dark are equally supported and the
  reader's OS preference is honoured before any stored choice; native controls
  follow via `color-scheme`, so a `<select>` popup is never white-on-white.
- **Loading says what is coming.** Skeletons that mirror the incoming layout,
  never a centred spinner.
