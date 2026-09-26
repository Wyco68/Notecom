# /quiz

## Purpose
Quiz creation and maintenance only — question/reasoning/answer content,
never lesson content.

## Load (and only these)
- [docs/quiz-guidelines.md](../../docs/quiz-guidelines.md)

Do not load `docs/teaching-guidelines.md`, `docs/html-output-contract.md`,
`docs/lesson-template.md`, `docs/architecture.md`, `docs/coding-style.md`,
`docs/ui-guidelines.md`, or `docs/api-contract.md` — quiz-guidelines.md is
self-contained (it defines its own tag allowlist and structure).

## Responsibilities
- Turn an uploaded file of questions into quiz HTML.
- Reply with the quiz HTML. **Saving is not yours:** the Notecom app checks
  the reply against the contract, names and numbers the quiz, and saves it
  to Supabase. You never write a file.

## Strict flow (run in this exact order)

1. **Destination is not yours to resolve.** The folder was chosen in the
   app's Generate dialog and the app files the quiz there. Don't look for
   `vault/`, `index.json` or other quizzes, and never validate a folder name
   against the content's topic.

2. **Get the source content.** The uploaded file's path is given in the
   prompt — never search the filesystem for it. If it's already Markdown
   text, read it directly. Any other format (PDF, PPTX, image) goes
   through the `markitdown` MCP server first, same reason as `/lect`: raw
   extraction from those formats is unreliable. If `markitdown` isn't
   connected, say so and stop rather than eyeballing the raw file.

3. **Produce the quiz content** per
   [quiz-guidelines.md](../../docs/quiz-guidelines.md): one `<h1>` quiz
   title taken from the content (the app names the quiz from it), then one
   `Q<n>.` block per question found in the source, `Q1.` onward, each with a
   worked `Reasoning:` callout and a plain `Answer:` callout.

4. **Reply with the HTML only** — the complete quiz, starting at the
   `<h1>`, with no code fence and no text before or after it. The reply *is*
   the output: the app extracts the document from it.

## What the app does with the reply
- Checks it against quiz-guidelines.md (`lib/generate/validate.ts`). On a
  violation it resumes this session with the list — fix exactly those
  problems and reply with the complete corrected HTML again, same rules as
  step 4. Nothing is saved until it passes.
- Names it (`<seq>-<slug>`, its own counter, independent of the folder's
  lessons) and saves it to Supabase. You compute none of that.

## Restrictions (strict)
- Never modify application code (`app/`, `components/`, `lib/`, `tools/`).
- Never write, create or edit any file or folder — the run only has read
  access, and the reply is the only output.
- Never produce lesson content.
- Never write Markdown as output — quiz output is HTML only, per
  quiz-guidelines.md.

## Redirect rule
If the request is lesson content, stop and tell the user to use `/lect`.
If the request is application/UI work, stop and tell the user to use
`/feat`. Do not do that work here.
