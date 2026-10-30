# /sheet

## Purpose
Cheatsheet creation only: a dense, printable summary of a range of a course's
chapters. Never lesson or quiz content.

## Load (and only these)
- [docs/cheatsheet-guidelines.md](../../docs/cheatsheet-guidelines.md)

Do not load `docs/teaching-guidelines.md`, `docs/html-output-contract.md`,
`docs/lesson-template.md`, `docs/quiz-guidelines.md` or any application doc —
cheatsheet-guidelines.md is self-contained.

## Responsibilities
- Turn the chapter files the app gives you into one cheatsheet fragment, or
  change a stored sheet the way the reader asks (edit mode, below).
- Reply with a `NOTE:` line and the fragment. **Everything else is the
  app's:** it checks the reply, saves the sheet in the folder, picks the
  paper and columns, splits it into pages and prints it. You never write a
  file.

## Strict flow

1. **Inputs come from the prompt.** It lists the chapter files (the course's
   lesson notes, one per chapter, in order), any extra source files (slides),
   the page limit, the layout and the character budget. Never search the
   filesystem for anything else.

2. **Read every input.** Chapter files are HTML; read them with Read. Extra
   files in PDF, PPTX, DOCX or image form go through the `markitdown` MCP
   server first; if it isn't connected, say so and stop. Read slide pages
   with diagrams, tables or code with Read as well, since text extraction
   drops those. A chapter file that shows slide pictures starts with a
   comment pairing each picture's `src` with a file: open one with Read only
   to judge whether it goes on the sheet (guidelines, "Pictures").

3. **Build the fact list in your head, chapter by chapter**: every
   definition, list item, number, formula, command, table row, worked
   example, comparison and diagram, from the files only.

4. **Write the fragment** per
   [cheatsheet-guidelines.md](../../docs/cheatsheet-guidelines.md): one
   `<h2>` per chapter numbered by its chapter number, in order, then that
   chapter's facts, with the pictures that carry facts the text doesn't,
   copied with the lesson's exact `src`, `width` and `height`. Fit the
   character budget.

5. **Check coverage** against the files, then reply with one line starting
   `NOTE:` that tells the reader in plain words what the sheet covers and
   anything left out, then the HTML, starting at the first `<h2>`: no code
   fence and nothing after it. The note is shown to the reader in the
   sheet's conversation; it is never printed.

## When the app sends it back
- **Contract violations**: fix exactly those, change nothing else, reply
  with the whole corrected fragment.
- **Too long for the page limit, or layout problems**: the app laid the
  sheet out and measured it. Cut by the percentage it gives, following the
  compression order in the guidelines, and fix each layout problem it lists
  (a table too wide, a code line or diagram label running out of its box,
  diagram labels on top of each other). Reply with the whole fragment.
- **Review findings**: a separate reviewer compared your sheet with the
  sources. Fix every finding against the sources (correct what is wrong,
  remove what the sources do not say, add what is missing), keep everything
  else, stay within the budget, and reply with the whole fragment.

## Chapter mode
When the prompt starts with `/sheet Chapter mode`, you write one chapter of a
sheet; the app writes the others in their own runs and saves each as it
comes, so a run that stops part-way keeps what is done.

1. Read that chapter's file and the other sources the prompt names; use
   only what belongs to this chapter.
2. Write only its section: `<h2>N. Title</h2>` and its content, no other
   `<h2>`, within this chapter's share of the budget (the prompt gives it).
3. Reply with one `NOTE:` line on what the chapter covers or had to leave
   out, then the section.

## Edit mode
When the prompt starts with `/sheet Edit mode`, the reader is changing a
sheet that already exists, through the chat box beside it.

1. Read the current sheet, the reader's request and the conversation so far
   (all three are files named in the prompt), then the chapter files.
2. Change what the request asks and keep everything else as it is. Every rule
   in the guidelines still holds, and the budget still applies: if adding
   something would overflow, say what you cut to make room.
3. Nothing comes from outside the source files, even when asked. If the
   request wants something the sources do not support, leave that part alone
   and say so in the note.
4. Reply with one `NOTE:` line saying in plain words what you changed (or
   why you didn't), then the complete fragment, starting at the first `<h2>`.

The new version goes through every check and the review again before it
replaces the old one.

## Review mode
When the prompt starts with `/sheet Review mode`, you are not the writer: you
check someone else's work, one chapter's section at a time. Change nothing
and write nothing.

1. Read the section file and every source file named in the prompt (slides
   through `markitdown`); from added documents use only what belongs to
   this chapter.
2. Go through the sheet line by line. For each line, find where the sources
   say it. Report:
   - `wrong`: the sources say something different (a number, a term, a
     default, an order of steps, a mix-up between two things);
   - `unsupported`: the sources do not say it at all;
   - `unclear`: so compressed it now reads as something else;
   - `missing`: a definition, list item, number, formula, command, table
     row, worked example or comparison in the sources that is not on the
     sheet, or a lesson picture whose facts are nowhere on it. Team
     members' and the customer's names and student IDs are never missing:
     they stay off the sheet (guidelines, "No personal names").
3. Check every number the prompt lists against the sources.
4. Reply with only the JSON object the prompt asks for. Quote the sheet
   exactly in `where`, and say in `fix` what the sources say and in which
   chapter. Report nothing about style or layout — only facts. An empty
   `issues` list means the sheet is correct and complete.
