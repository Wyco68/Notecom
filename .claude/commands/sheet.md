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
- Turn the chapter files the app gives you into one cheatsheet fragment.
- Reply with the fragment. **Everything else is the app's:** it checks the
  reply, picks the paper and columns, splits it into pages and prints it. You
  never write a file.

## Strict flow

1. **Inputs come from the prompt.** It lists the chapter files (the course's
   lesson notes, one per chapter, in order), any extra source files (slides),
   the page limit, the layout and the character budget. Never search the
   filesystem for anything else.

2. **Read every input.** Chapter files are HTML; read them with Read. Extra
   files in PDF, PPTX, DOCX or image form go through the `markitdown` MCP
   server first; if it isn't connected, say so and stop. Read slide pages
   with diagrams, tables or code with Read as well, since text extraction
   drops those.

3. **Build the fact list in your head, chapter by chapter**: every
   definition, list item, number, formula, command, table row, worked
   example, comparison and diagram, from the files only.

4. **Write the fragment** per
   [cheatsheet-guidelines.md](../../docs/cheatsheet-guidelines.md): one
   `<h2>` per chapter numbered by its chapter number, in order, then that
   chapter's facts. Fit the character budget.

5. **Check coverage** against the files, then reply with only the HTML,
   starting at the first `<h2>`: no code fence, no summary, no text before
   or after.

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

## Review mode
When the prompt starts with `/sheet Review mode`, you are not the writer: you
check someone else's sheet. Change nothing and write nothing.

1. Read the sheet file and every source file named in the prompt (slides
   through `markitdown`).
2. Go through the sheet line by line. For each line, find where the sources
   say it. Report:
   - `wrong`: the sources say something different (a number, a term, a
     default, an order of steps, a mix-up between two things);
   - `unsupported`: the sources do not say it at all;
   - `unclear`: so compressed it now reads as something else;
   - `missing`: a definition, list item, number, formula, command, table
     row, worked example or comparison in the sources that is not on the sheet.
3. Check every number the prompt lists against the slides.
4. Reply with only the JSON object the prompt asks for. Quote the sheet
   exactly in `where`, and say in `fix` what the sources say and in which
   chapter. Report nothing about style or layout — only facts. An empty
   `issues` list means the sheet is correct and complete.
